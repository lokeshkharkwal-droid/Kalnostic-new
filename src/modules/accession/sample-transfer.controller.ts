import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { PermissionGuard } from '../permissions/guards/permission.guard';
import {
  RequirePermission,
  RequireAnyPermission,
} from '../permissions/decorators/require-permission.decorator';
import {
  PERMISSION_KEYS,
  ACCESSION_TRANSFER_KEY_GROUPS,
} from '../permissions/constants/module-permissions.constant';
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
 * profile. Sending-side actions live under `order-samples/*` (they act on a
 * sample); the receiving queue + §B.10 lifecycle live under `transfers/*`. Each has a
 * single (`:id/<action>`) and a bulk (`bulk/<action>`, `{ ids: [] }`) variant.
 *
 * NOTE: bulk routes are declared before the `:id/...` routes so `bulk` is never
 * captured as an `:id`.
 */
@Controller('accession')
@UseGuards(PermissionGuard)
export class SampleTransferController {
  constructor(private readonly transfers: SampleTransferService) {}

  // ── Sending side (bulk before :id) — operate on SAMPLE ids ─────────────────

  /** Bulk Send (Internal Transfer). */
  @Post('order-samples/bulk/send')
  @RequirePermission(PERMISSION_KEYS.ACC_IH_SEND)
  @Audit(auditUpdate('Bulk sent samples (internal transfer)'))
  bulkSend(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Body() dto: BulkSendDto,
  ) {
    return this.transfers.send(dto.ids, tenantId, personId, dto);
  }

  /** Bulk Forward (External Transfer). */
  @Post('order-samples/bulk/forward')
  @RequirePermission(PERMISSION_KEYS.ACC_IH_FORWARD)
  @Audit(auditUpdate('Bulk forwarded samples (external transfer)'))
  bulkForward(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Body() dto: BulkForwardDto,
  ) {
    return this.transfers.forward(dto.ids, tenantId, personId, dto);
  }

  /** Bulk Outsource. */
  @Post('order-samples/bulk/outsource')
  @RequirePermission(PERMISSION_KEYS.ACC_IH_OUTSOURCE)
  @Audit(auditUpdate('Bulk outsourced samples'))
  bulkOutsource(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Body() dto: BulkOutsourceDto,
  ) {
    return this.transfers.outsource(dto.ids, tenantId, personId, dto);
  }

  /** Send (Internal Transfer) — Accepted → Sent (Internal). */
  @Post('order-samples/:id/send')
  @RequirePermission(PERMISSION_KEYS.ACC_IH_SEND)
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
  @Post('order-samples/:id/forward')
  @RequirePermission(PERMISSION_KEYS.ACC_IH_FORWARD)
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
  @Post('order-samples/:id/outsource')
  @RequirePermission(PERMISSION_KEYS.ACC_IH_OUTSOURCE)
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
  @RequireAnyPermission(...ACCESSION_TRANSFER_KEY_GROUPS.PICK_UP)
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
  @RequireAnyPermission(...ACCESSION_TRANSFER_KEY_GROUPS.RECEIVE)
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
  @RequireAnyPermission(...ACCESSION_TRANSFER_KEY_GROUPS.ACCEPT)
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
  @RequireAnyPermission(...ACCESSION_TRANSFER_KEY_GROUPS.REPEAT)
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
  @RequireAnyPermission(...ACCESSION_TRANSFER_KEY_GROUPS.REJECT)
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
  @RequireAnyPermission(...ACCESSION_TRANSFER_KEY_GROUPS.PICK_UP)
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
  @RequireAnyPermission(...ACCESSION_TRANSFER_KEY_GROUPS.RECEIVE)
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
  @RequireAnyPermission(...ACCESSION_TRANSFER_KEY_GROUPS.ACCEPT)
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
  @RequireAnyPermission(...ACCESSION_TRANSFER_KEY_GROUPS.REPEAT)
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
  @RequireAnyPermission(...ACCESSION_TRANSFER_KEY_GROUPS.REJECT)
  @Audit(auditUpdate('Rejected a transfer'))
  async reject(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: TransferRejectDto,
  ) {
    return (await this.transfers.reject([id], tenantId, personId, dto))[0];
  }

  /**
   * Assign/Update Center (§A.7). Setting a MISSING destination requires the
   * *Assign … center* permission; changing an ALREADY-SET one requires
   * *Update … center* — enforced programmatically in the service (assertAny per
   * group) since one endpoint serves both.
   */
  @Post('transfers/:id/assign-center')
  @Audit(auditUpdate('Assigned a transfer center'))
  assignCenter(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
    @Body() dto: AssignCenterDto,
  ) {
    return this.transfers.assignCenter(id, tenantId, personId, dto, {
      branchId: profile.branchId,
      profileKey: profile.profileKey,
    });
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
