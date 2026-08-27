import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CommunicationLog, CommunicationStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CommunicationService } from './communication.service';

/**
 * Background worker that drains the `communication_logs` queue and delivers each
 * PENDING message through the Exchange gateway. Runs on a fixed interval, gated
 * by `COMMUNICATION_WORKER_ENABLED` so it can be enabled on exactly one instance
 * per environment.
 *
 * ## RLS safety (CLAUDE.md §4.3; memory: RLS outside request context)
 * The cron fires with NO request and NO tenant context, and `communication_logs`
 * has FORCE ROW LEVEL SECURITY — so an unscoped scan returns zero rows when
 * `RLS_ENABLED=true`. Following `AuditService.purgeExpired`, the worker enumerates
 * the platform-level `tenants` table (no RLS), then does every queue read/write
 * for a tenant inside `prisma.withTenant(tenantId, …)` (which sets the tenant
 * GUC). The Exchange HTTP call happens BETWEEN two short transactions — never
 * while a DB transaction is open — so a slow gateway never pins a connection.
 *
 * Single-writer assumption: one enabled instance. For multi-instance, add a
 * `lockedUntil` claim column and claim via a conditional `updateMany`.
 */
@Injectable()
export class CommunicationWorkerService {
  private readonly logger = new Logger(CommunicationWorkerService.name);
  /** Guards against overlapping runs when a drain outlasts the interval. */
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly communication: CommunicationService,
  ) {}

  /**
   * Drain due PENDING messages for every tenant once per tick. Enabled only when
   * `COMMUNICATION_WORKER_ENABLED=true`. Never throws — per-row failures are
   * recorded on the row and retried up to `maxRetry`.
   * @returns the number of rows processed this tick
   */
  @Cron(CronExpression.EVERY_30_SECONDS)
  async drain(): Promise<number> {
    if (!this.config.get<boolean>('communication.workerEnabled')) return 0;
    if (this.running) return 0;
    this.running = true;
    try {
      return await this.drainOnce();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Communication drain failed: ${message}`);
      return 0;
    } finally {
      this.running = false;
    }
  }

  /**
   * One drain pass across all tenants: claim a batch of due rows per tenant,
   * dispatch each, and persist the outcome. Extracted for testability.
   * @returns the number of rows processed
   */
  private async drainOnce(): Promise<number> {
    const batch = this.config.get<number>('communication.workerBatch', 50);
    const now = new Date();
    const tenants = await this.prisma.tenant.findMany({ select: { id: true } });

    let processed = 0;
    for (const { id: tenantId } of tenants) {
      // 1. Claim a batch of due rows (GUC set for the read).
      const due = await this.prisma.withTenant(tenantId, (tx) =>
        tx.communicationLog.findMany({
          where: {
            tenantId,
            status: CommunicationStatus.PENDING,
            deletedAt: null,
            OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }],
          },
          orderBy: { createdAt: 'asc' },
          take: batch,
        }),
      );
      if (due.length === 0) continue;

      for (const row of due) {
        // Drop rows past their expiry rather than sending them.
        if (row.expiryDate && row.expiryDate.getTime() < now.getTime()) {
          await this.mark(tenantId, row.id, {
            status: CommunicationStatus.CANCELLED,
            statusMessage: 'Expired before delivery',
          });
          processed += 1;
          continue;
        }

        // 2. Deliver OUTSIDE any transaction (network call).
        const resp = await this.communication.dispatch(row);
        const ok = this.exchangeOk(resp);

        // 3. Persist the outcome (GUC set for the write).
        await this.mark(tenantId, row.id, this.outcome(row, ok, resp));
        processed += 1;
      }
    }
    if (processed > 0) {
      this.logger.log(`Communication drain processed ${processed} row(s)`);
    }
    return processed;
  }

  /** Compute the next state for a row after a delivery attempt. */
  private outcome(
    row: CommunicationLog,
    ok: boolean,
    resp: unknown,
  ): Partial<CommunicationLog> {
    if (ok) {
      const exchangeId =
        resp && typeof resp === 'object' && 'id' in resp
          ? String(resp.id)
          : null;
      return {
        status: CommunicationStatus.SENT,
        sentAt: new Date(),
        exchangeId,
        statusMessage: 'Delivered via Exchange gateway',
      };
    }
    const nextRetry = row.retry + 1;
    if (nextRetry >= row.maxRetry) {
      return {
        status: CommunicationStatus.FAILED,
        retry: nextRetry,
        statusMessage: 'Exchange gateway did not accept the message',
      };
    }
    return {
      status: CommunicationStatus.PENDING,
      retry: nextRetry,
      statusMessage: 'Delivery attempt failed; will retry',
    };
  }

  /** Persist a row's post-attempt state inside a tenant transaction. */
  private async mark(
    tenantId: string,
    id: string,
    data: Partial<CommunicationLog>,
  ): Promise<void> {
    await this.prisma.withTenant(tenantId, (tx) =>
      tx.communicationLog.update({
        where: { id },
        data: {
          status: data.status,
          ...(data.sentAt !== undefined ? { sentAt: data.sentAt } : {}),
          ...(data.exchangeId !== undefined
            ? { exchangeId: data.exchangeId }
            : {}),
          ...(data.retry !== undefined ? { retry: data.retry } : {}),
          ...(data.statusMessage !== undefined
            ? { statusMessage: data.statusMessage }
            : {}),
        },
      }),
    );
  }

  /** True when the Exchange response was accepted (non-null `id`). */
  private exchangeOk(resp: unknown): boolean {
    return (
      !!resp && typeof resp === 'object' && 'id' in resp && resp.id != null
    );
  }
}
