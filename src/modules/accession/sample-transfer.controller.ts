import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { SampleTransferService } from './sample-transfer.service';
import { ListTransfersDto } from './dto/list-transfers.dto';
import { SendSampleDto } from './dto/send-sample.dto';
import { ForwardSampleDto } from './dto/forward-sample.dto';
import { OutsourceSampleDto } from './dto/outsource-sample.dto';
import { TransferPickUpDto } from './dto/transfer-pickup.dto';
import { TransferReceiveDto } from './dto/transfer-receive.dto';
import { TransferRepeatDto } from './dto/transfer-repeat.dto';
import { TransferRejectDto } from './dto/transfer-reject.dto';
import { SampleNoteDto } from './dto/sample-note.dto';
import { AssignCenterDto } from './dto/assign-center.dto';
import { OutsourceStatusDto } from './dto/outsource-status.dto';
import {
  BulkForwardDto,
  BulkOutsourceDto,
  BulkPickUpDto,
  BulkReceiveDto,
  BulkSendDto,
  BulkTransferAcceptDto,
  BulkTransferRejectDto,
  BulkTransferRepeatDto,
} from './dto/bulk-transfer-action.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/** `@Audit` metadata shared by every transfer write route. */
const auditUpdate = (description: string) => ({
  module: AuditModule.ACCESSION,
  action: AuditAction.UPDATE,
  description,
});

/**
 * Sample-transfer endpoints (PDF Parts B/C/D — Internal/External Referral +
 * Outsource). Business-authenticated; tenant from the JWT, branch from the active
 * profile. Sending-side actions live under `samples/*` (they act on a sample);
 * the receiving queue + §B.10 lifecycle live under `transfers/*`. Each has a
 * single (`:id/<action>`) and a bulk (`bulk/<action>`, `{ ids: [] }`) variant.
 *
 * NOTE: bulk routes are declared before the `:id/...` routes so `bulk` is never
 * captured as an `:id`.
 */
@Controller('accession')
export class SampleTransferController {
  constructor(private readonly transfers: SampleTransferService) {}

  // ── Sending side (bulk before :id) — operate on SAMPLE ids ─────────────────

  /** Bulk Send (Internal Transfer). */
  @Post('samples/bulk/send')
  @Audit(auditUpdate('Bulk sent samples (internal transfer)'))
  bulkSend(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Body() dto: BulkSendDto,
  ) {
    return this.transfers.send(dto.ids, tenantId, personId, dto);
  }

  /** Bulk Forward (External Transfer). */
  @Post('samples/bulk/forward')
  @Audit(auditUpdate('Bulk forwarded samples (external transfer)'))
  bulkForward(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Body() dto: BulkForwardDto,
  ) {
    return this.transfers.forward(dto.ids, tenantId, personId, dto);
  }

  /** Bulk Outsource. */
  @Post('samples/bulk/outsource')
  @Audit(auditUpdate('Bulk outsourced samples'))
  bulkOutsource(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Body() dto: BulkOutsourceDto,
  ) {
    return this.transfers.outsource(dto.ids, tenantId, personId, dto);
  }

  /** Send (Internal Transfer) — Accepted → Sent (Internal). */
  @Post('samples/:id/send')
  @Audit(auditUpdate('Sent a sample (internal transfer)'))
  async send(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: SendSampleDto,
  ) {
    return (await this.transfers.send([id], tenantId, personId, dto))[0];
  }

  /** Forward (External Transfer) — Accepted → Forward (External). */
  @Post('samples/:id/forward')
  @Audit(auditUpdate('Forwarded a sample (external transfer)'))
  async forward(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: ForwardSampleDto,
  ) {
    return (await this.transfers.forward([id], tenantId, personId, dto))[0];
  }

  /** Outsource — Accepted → Outsourced. */
  @Post('samples/:id/outsource')
  @Audit(auditUpdate('Outsourced a sample'))
  async outsource(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: OutsourceSampleDto,
  ) {
    return (await this.transfers.outsource([id], tenantId, personId, dto))[0];
  }

  // ── Receiving side — queue + §B.10 lifecycle on TRANSFER ids ───────────────

  /** Referral queue (Internal/External), filterable by kind/status/direction. */
  @Get('transfers')
  findTransfers(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: ListTransfersDto,
  ) {
    return this.transfers.findTransfers(tenantId, profile.branchId, query);
  }

  /** Bulk Picked Up. */
  @Post('transfers/bulk/pick-up')
  @Audit(auditUpdate('Bulk picked up transfers'))
  bulkPickUp(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Body() dto: BulkPickUpDto,
  ) {
    return this.transfers.pickUp(dto.ids, tenantId, personId, dto);
  }

  /** Bulk Receive. */
  @Post('transfers/bulk/receive')
  @Audit(auditUpdate('Bulk received transfers'))
  bulkReceive(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Body() dto: BulkReceiveDto,
  ) {
    return this.transfers.receive(dto.ids, tenantId, personId, dto);
  }

  /** Bulk Accept (RULE 1 clone per transfer). */
  @Post('transfers/bulk/accept')
  @Audit(auditUpdate('Bulk accepted transfers'))
  bulkAccept(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Body() dto: BulkTransferAcceptDto,
  ) {
    return this.transfers.accept(dto.ids, tenantId, personId, dto);
  }

  /** Bulk Repeat. */
  @Post('transfers/bulk/repeat')
  @Audit(auditUpdate('Bulk repeated transfers'))
  bulkRepeat(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Body() dto: BulkTransferRepeatDto,
  ) {
    return this.transfers.repeatTransfer(dto.ids, tenantId, personId, dto);
  }

  /** Bulk Reject. */
  @Post('transfers/bulk/reject')
  @Audit(auditUpdate('Bulk rejected transfers'))
  bulkReject(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Body() dto: BulkTransferRejectDto,
  ) {
    return this.transfers.reject(dto.ids, tenantId, personId, dto);
  }

  /** Fetch one transfer (with sample + order context). */
  @Get('transfers/:id')
  findTransfer(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.transfers.findTransferById(id, tenantId);
  }

  /** Picked Up (§B.11.1). */
  @Post('transfers/:id/pick-up')
  @Audit(auditUpdate('Picked up a transfer'))
  async pickUp(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: TransferPickUpDto,
  ) {
    return (await this.transfers.pickUp([id], tenantId, personId, dto))[0];
  }

  /** Receive (§B.11.2). */
  @Post('transfers/:id/receive')
  @Audit(auditUpdate('Received a transfer'))
  async receive(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: TransferReceiveDto,
  ) {
    return (await this.transfers.receive([id], tenantId, personId, dto))[0];
  }

  /** Accept (§B.11.3) — INTERNAL clones into In-House (RULE 1). */
  @Post('transfers/:id/accept')
  @Audit(auditUpdate('Accepted a transfer'))
  async accept(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: SampleNoteDto,
  ) {
    return (await this.transfers.accept([id], tenantId, personId, dto))[0];
  }

  /** Repeat (§B.11.4). */
  @Post('transfers/:id/repeat')
  @Audit(auditUpdate('Repeated a transfer'))
  async repeat(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: TransferRepeatDto,
  ) {
    return (
      await this.transfers.repeatTransfer([id], tenantId, personId, dto)
    )[0];
  }

  /** Reject (§B.11.5). */
  @Post('transfers/:id/reject')
  @Audit(auditUpdate('Rejected a transfer'))
  async reject(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: TransferRejectDto,
  ) {
    return (await this.transfers.reject([id], tenantId, personId, dto))[0];
  }

  /** Assign Center (§A.7) — set a missing destination. */
  @Post('transfers/:id/assign-center')
  @Audit(auditUpdate('Assigned a transfer center'))
  assignCenter(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: AssignCenterDto,
  ) {
    return this.transfers.assignCenter(id, tenantId, personId, dto);
  }

  /** Manually update an OUTSOURCE transfer's status (CR-3). */
  @Post('transfers/:id/outsource-status')
  @Audit(auditUpdate('Updated outsource status'))
  outsourceStatus(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: OutsourceStatusDto,
  ) {
    return this.transfers.updateOutsourceStatus(id, tenantId, personId, dto);
  }
}
