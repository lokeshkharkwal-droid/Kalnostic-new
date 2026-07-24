import { Injectable } from '@nestjs/common';
import { LeadStatus, PipelineStage, Prisma } from '@prisma/client';

/**
 * Shared writer for a lead's status + `LeadStatusHistory` entry, callable on an
 * EXISTING tenant transaction. Lives in the trip module — the shared sales hub
 * (alongside `SalesStaffService`) — so the lead, follow-up and trip services can
 * all inject it without a circular module dependency. It is the single source of
 * truth for the `Lead.status` update + history row.
 */
@Injectable()
export class SalesLeadStatusService {
  /**
   * Apply a lead status change + history entry on the caller's transaction. The
   * caller MUST already run inside `prisma.withTenant` (so RLS + rollback apply).
   * @param tx the caller's transaction-scoped Prisma client
   * @param tenantId tenant scope
   * @param leadId the lead to transition
   * @param fromStatus the lead's current status (recorded on the history row)
   * @param toStatus the status to set
   * @param actorId person id of the actor (audit trail)
   * @param opts optional history action label + pipeline/converted/meta fields
   */
  async applyStatusInTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    leadId: string,
    fromStatus: LeadStatus,
    toStatus: LeadStatus,
    actorId?: string,
    opts: {
      action?: string;
      pipelineStage?: PipelineStage;
      convertedValue?: number;
      remarks?: string;
      gps?: string;
      attachmentUrl?: string;
    } = {},
  ): Promise<void> {
    const data: Prisma.LeadUpdateInput = {
      status: toStatus,
      updatedBy: actorId ?? null,
    };
    if (opts.pipelineStage) data.pipelineStage = opts.pipelineStage;
    if (opts.convertedValue !== undefined)
      data.convertedValue = opts.convertedValue;
    await tx.lead.update({ where: { id: leadId }, data });
    await tx.leadStatusHistory.create({
      data: {
        tenantId,
        leadId,
        action: opts.action ?? `Status → ${toStatus}`,
        fromStatus,
        toStatus,
        byPersonId: actorId ?? null,
        remarks: opts.remarks ?? null,
        gps: opts.gps ?? null,
        attachmentUrl: opts.attachmentUrl ?? null,
      },
    });
  }
}
