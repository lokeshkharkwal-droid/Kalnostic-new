import { Injectable } from '@nestjs/common';
import {
  ExternalIdCounterType,
  ExternalIdFormat,
  ExternalIdPurpose,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BranchService } from '../branch/branch.service';
import { RegistrationSettingsService } from './registration-settings.service';

/** Parts used to build a formatted external id. */
export interface ExternalIdParts {
  now: Date;
  /** Branch short name, used only by the BRANCH_* formats. */
  shortName: string;
  /** 1-based running sequence for the format's reset period. */
  sequence: number;
}

/** The next external id a branch would mint for a purpose (peek, no bump). */
export interface ExternalIdPreview {
  format: ExternalIdFormat;
  /** Formatted preview, or null when the format is NONE (manual entry). */
  value: string | null;
}

/**
 * Which reset period a format's running sequence uses. NONE has no counter
 * (manual entry).
 */
export function counterTypeForFormat(
  format: ExternalIdFormat,
): ExternalIdCounterType | null {
  switch (format) {
    case ExternalIdFormat.YMD_DAILY:
    case ExternalIdFormat.BRANCH_YMD_DAILY:
    case ExternalIdFormat.YMD_COMPACT_DAILY:
      return ExternalIdCounterType.DAILY;
    case ExternalIdFormat.YM_MONTHLY:
    case ExternalIdFormat.BRANCH_YM_MONTHLY:
      return ExternalIdCounterType.MONTHLY;
    case ExternalIdFormat.Y_YEARLY:
    case ExternalIdFormat.BRANCH_Y_YEARLY:
      return ExternalIdCounterType.YEARLY;
    case ExternalIdFormat.NONE:
    default:
      return null;
  }
}

/**
 * Whether a counter of the given type has rolled over since `lastResetAt`
 * (so the next sequence should restart at 1). Mirrors the legacy Kishan
 * `branch_order_counter` day/month/year comparison.
 */
export function shouldResetCounter(
  counterType: ExternalIdCounterType,
  lastResetAt: Date,
  now: Date,
): boolean {
  const sameYear = lastResetAt.getFullYear() === now.getFullYear();
  const sameMonth = sameYear && lastResetAt.getMonth() === now.getMonth();
  const sameDay = sameMonth && lastResetAt.getDate() === now.getDate();
  switch (counterType) {
    case ExternalIdCounterType.DAILY:
      return !sameDay;
    case ExternalIdCounterType.MONTHLY:
      return !sameMonth;
    case ExternalIdCounterType.YEARLY:
      return !sameYear;
    default:
      return false;
  }
}

/**
 * Pure formatter porting the legacy Kishan external-order-id builder
 * (`LabMasterCodes::getFormattedExternalOrderIdForOrderSequence`, RP-code
 * variants excluded). Full 4-digit year; sequence zero-padded to 4 digits.
 * Returns null for NONE. Examples (2026-04-19, seq 1, shortName "ABC"):
 *   YMD_DAILY → 2026/04/19/0001    BRANCH_YMD_DAILY → ABC/2026/04/19/0001
 *   YMD_COMPACT_DAILY → 202604190001
 *   YM_MONTHLY → 2026/04/0001      BRANCH_YM_MONTHLY → ABC/2026/04/0001
 *   Y_YEARLY → 2026/0001           BRANCH_Y_YEARLY → ABC/2026/0001
 */
export function formatExternalId(
  format: ExternalIdFormat,
  parts: ExternalIdParts,
): string | null {
  const { now, shortName, sequence } = parts;
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const seq4 = String(sequence).padStart(4, '0');
  const branch = shortName.trim();
  switch (format) {
    case ExternalIdFormat.YMD_DAILY:
      return `${yyyy}/${mm}/${dd}/${seq4}`;
    case ExternalIdFormat.BRANCH_YMD_DAILY:
      return `${branch}/${yyyy}/${mm}/${dd}/${seq4}`;
    case ExternalIdFormat.YMD_COMPACT_DAILY:
      return `${yyyy}${mm}${dd}${seq4}`;
    case ExternalIdFormat.YM_MONTHLY:
      return `${yyyy}/${mm}/${seq4}`;
    case ExternalIdFormat.BRANCH_YM_MONTHLY:
      return `${branch}/${yyyy}/${mm}/${seq4}`;
    case ExternalIdFormat.Y_YEARLY:
      return `${yyyy}/${seq4}`;
    case ExternalIdFormat.BRANCH_Y_YEARLY:
      return `${branch}/${yyyy}/${seq4}`;
    case ExternalIdFormat.NONE:
    default:
      return null;
  }
}

/**
 * Generates the legacy-style external order/quote id for a branch from its
 * configured `ExternalIdFormat` (Registration Settings), backed by a per-branch
 * running counter (`ExternalIdCounter`) that resets daily/monthly/yearly.
 * Orders and quotations keep independent counters (see `ExternalIdPurpose`).
 * `generateInTx` runs inside the caller's order-create transaction so the bump
 * commits atomically with the order; `previewNext` peeks without bumping so the
 * frontend can show a disabled preview before submit.
 */
@Injectable()
export class ExternalIdService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchService: BranchService,
    private readonly registrationSettingsService: RegistrationSettingsService,
  ) {}

  /** The branch's configured format for a purpose (ORDER vs QUOTATION). */
  async getConfiguredFormat(
    tenantId: string,
    branchId: string,
    purpose: ExternalIdPurpose,
  ): Promise<ExternalIdFormat> {
    const settings = await this.registrationSettingsService.getForBranch(
      tenantId,
      branchId,
    );
    return purpose === ExternalIdPurpose.QUOTATION
      ? settings.Quotation_AutoIncrementExternalQuoteIdFormat
      : settings.OrderIdConfiguration_AutoIncrementExternalOrderIdFormat;
  }

  /**
   * Atomically bump the branch's counter for `(purpose, format)` and return the
   * formatted id. MUST be called inside a transaction (`tx`) — typically the
   * order-create transaction. Returns null when `format` is NONE (manual entry).
   * @param shortName the branch's short name (BRANCH_* prefix)
   */
  async generateInTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    branchId: string,
    purpose: ExternalIdPurpose,
    format: ExternalIdFormat,
    shortName: string,
  ): Promise<string | null> {
    const counterType = counterTypeForFormat(format);
    if (!counterType) return null; // NONE → manual entry

    const now = new Date();
    const existing = await tx.externalIdCounter.findUnique({
      where: {
        tenantId_branchId_purpose_counterType: {
          tenantId,
          branchId,
          purpose,
          counterType,
        },
      },
    });

    let sequence: number;
    if (!existing) {
      await tx.externalIdCounter.create({
        data: {
          tenantId,
          branchId,
          purpose,
          counterType,
          counter: 1,
          lastResetAt: now,
        },
      });
      sequence = 1;
    } else {
      const reset = shouldResetCounter(counterType, existing.lastResetAt, now);
      sequence = reset ? 1 : existing.counter + 1;
      await tx.externalIdCounter.update({
        where: { id: existing.id },
        data: {
          counter: sequence,
          lastResetAt: reset ? now : existing.lastResetAt,
        },
      });
    }

    return formatExternalId(format, { now, shortName, sequence });
  }

  /**
   * Peek the next external id a branch would mint for a purpose, WITHOUT
   * bumping the counter — used by the frontend to show the disabled preview on
   * the create form. Returns `{ format, value: null }` when the format is NONE.
   * @throws BranchNotFoundException if the branch is missing/other tenant
   */
  async previewNext(
    tenantId: string,
    branchId: string,
    purpose: ExternalIdPurpose,
  ): Promise<ExternalIdPreview> {
    const branch = await this.branchService.findById(branchId, tenantId);
    const format = await this.getConfiguredFormat(tenantId, branchId, purpose);
    const counterType = counterTypeForFormat(format);
    if (!counterType) return { format, value: null };

    const now = new Date();
    const existing = await this.prisma.externalIdCounter.findUnique({
      where: {
        tenantId_branchId_purpose_counterType: {
          tenantId,
          branchId,
          purpose,
          counterType,
        },
      },
    });
    const nextSequence =
      !existing || shouldResetCounter(counterType, existing.lastResetAt, now)
        ? 1
        : existing.counter + 1;
    return {
      format,
      value: formatExternalId(format, {
        now,
        shortName: branch.shortName,
        sequence: nextSequence,
      }),
    };
  }
}
