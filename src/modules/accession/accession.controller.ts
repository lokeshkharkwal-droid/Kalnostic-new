import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { AccessionSampleService } from './accession-sample.service';
import { ListSamplesDto } from './dto/list-samples.dto';
import { SampleNoteDto } from './dto/sample-note.dto';
import { CollectSampleDto } from './dto/collect-sample.dto';
import { AcceptSampleDto } from './dto/accept-sample.dto';
import { StoreSampleDto } from './dto/store-sample.dto';
import { DiscardSampleDto } from './dto/discard-sample.dto';
import { CancelSampleDto } from './dto/cancel-sample.dto';
import { RepeatSampleDto } from './dto/repeat-sample.dto';
import { ReturnSampleDto } from './dto/return-sample.dto';
import { AssignBarcodeDto } from './dto/assign-barcode.dto';
import { ShareSampleDto } from './dto/share-sample.dto';
import {
  BulkAcceptDto,
  BulkCancelDto,
  BulkCollectDto,
  BulkDiscardDto,
  BulkRepeatDto,
  BulkReturnDto,
  BulkSampleNoteDto,
  BulkStoreDto,
} from './dto/bulk-sample-action.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/** `@Audit` metadata shared by every accession write route. */
const auditUpdate = (description: string) => ({
  module: AuditModule.ACCESSION,
  action: AuditAction.UPDATE,
  description,
});

/**
 * Accession module endpoints (PDF Part A — In-House Orders). Business-authenticated;
 * tenant comes from the JWT and the branch from the active profile (global
 * `JwtAuthGuard`). Exposes the accession list + summary (status tabs / TAT bar),
 * Sample Overview, Sample History, and the full §A.9 state machine as per-action
 * routes, each with a single-item (`:id/<action>`) and a bulk (`bulk/<action>`,
 * `{ ids: [] }`) variant. Writes are audited under `AuditModule.ACCESSION`.
 *
 * NOTE: bulk routes are declared before the `:id/...` routes so `bulk` is never
 * captured as an `:id`.
 */
@Controller('accession/samples')
export class AccessionController {
  constructor(private readonly sampleService: AccessionSampleService) {}

  // ── Reads ──────────────────────────────────────────────────────────────────

  /** List accession samples (paginated, §A.3 filters + §A.5 tabs + §A.4 TAT). */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: ListSamplesDto,
  ) {
    return this.sampleService.findAll(tenantId, profile.branchId, query);
  }

  /** Summary counts for the status tabs (§A.5) + TAT bar (§A.4) + total. */
  @Get('summary')
  summary(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
  ) {
    return this.sampleService.summary(tenantId, profile.branchId);
  }

  // ── Bulk actions (§A.11) — declared before `:id` routes ────────────────────

  /** Bulk Collect. */
  @Post('bulk/collect')
  @Audit(auditUpdate('Bulk collected samples'))
  bulkCollect(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Body() dto: BulkCollectDto,
  ) {
    return this.sampleService.collect(dto.ids, tenantId, personId, dto);
  }

  /** Bulk Collect & Print. */
  @Post('bulk/collect-print')
  @Audit(auditUpdate('Bulk collected & printed samples'))
  bulkCollectPrint(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Body() dto: BulkCollectDto,
  ) {
    return this.sampleService.collectAndPrint(dto.ids, tenantId, personId, dto);
  }

  /** Bulk Accept. */
  @Post('bulk/accept')
  @Audit(auditUpdate('Bulk accepted samples'))
  bulkAccept(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Body() dto: BulkAcceptDto,
  ) {
    return this.sampleService.accept(dto.ids, tenantId, personId, dto);
  }

  /** Bulk Acquire. */
  @Post('bulk/acquire')
  @Audit(auditUpdate('Bulk acquired samples'))
  bulkAcquire(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Body() dto: BulkSampleNoteDto,
  ) {
    return this.sampleService.acquire(dto.ids, tenantId, personId, dto);
  }

  /** Bulk Hault. */
  @Post('bulk/halt')
  @Audit(auditUpdate('Bulk halted samples'))
  bulkHalt(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Body() dto: BulkSampleNoteDto,
  ) {
    return this.sampleService.halt(dto.ids, tenantId, personId, dto);
  }

  /** Bulk Error. */
  @Post('bulk/error')
  @Audit(auditUpdate('Bulk flagged samples errored'))
  bulkError(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Body() dto: BulkSampleNoteDto,
  ) {
    return this.sampleService.error(dto.ids, tenantId, personId, dto);
  }

  /** Bulk Hold. */
  @Post('bulk/hold')
  @Audit(auditUpdate('Bulk held samples'))
  bulkHold(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Body() dto: BulkSampleNoteDto,
  ) {
    return this.sampleService.hold(dto.ids, tenantId, personId, dto);
  }

  /** Bulk Repeat. */
  @Post('bulk/repeat')
  @Audit(auditUpdate('Bulk flagged samples for repeat'))
  bulkRepeat(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Body() dto: BulkRepeatDto,
  ) {
    return this.sampleService.repeat(dto.ids, tenantId, personId, dto);
  }

  /** Bulk Store. */
  @Post('bulk/store')
  @Audit(auditUpdate('Bulk stored samples'))
  bulkStore(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Body() dto: BulkStoreDto,
  ) {
    return this.sampleService.store(dto.ids, tenantId, personId, dto);
  }

  /** Bulk Discard. */
  @Post('bulk/discard')
  @Audit(auditUpdate('Bulk discarded samples'))
  bulkDiscard(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Body() dto: BulkDiscardDto,
  ) {
    return this.sampleService.discard(dto.ids, tenantId, personId, dto);
  }

  /** Bulk Return. */
  @Post('bulk/return')
  @Audit(auditUpdate('Bulk returned samples'))
  bulkReturn(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Body() dto: BulkReturnDto,
  ) {
    return this.sampleService.returnSample(dto.ids, tenantId, personId, dto);
  }

  /** Bulk Cancel. */
  @Post('bulk/cancel')
  @Audit(auditUpdate('Bulk cancelled samples'))
  bulkCancel(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Body() dto: BulkCancelDto,
  ) {
    return this.sampleService.cancel(dto.ids, tenantId, personId, dto);
  }

  /** Bulk Retrieve (universal undo). */
  @Post('bulk/retrieve')
  @Audit(auditUpdate('Bulk retrieved samples'))
  bulkRetrieve(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Body() dto: BulkSampleNoteDto,
  ) {
    return this.sampleService.retrieve(dto.ids, tenantId, personId, dto);
  }

  /** Bulk Assign Barcode (system-generated per sample). */
  @Post('bulk/assign-barcode')
  @Audit(auditUpdate('Bulk assigned barcodes'))
  bulkAssignBarcode(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Body() dto: BulkSampleNoteDto,
  ) {
    return this.sampleService.assignBarcode(dto.ids, tenantId, personId, {});
  }

  // ── Single-sample reads ────────────────────────────────────────────────────

  /** Fetch one sample fully composed (Sample Overview — §A.10.4). */
  @Get(':id')
  findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.sampleService.findById(id, tenantId);
  }

  /** Fetch a sample's status-change history (§A.10.5, newest first). */
  @Get(':id/history')
  findHistory(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.sampleService.findHistory(id, tenantId);
  }

  // ── Single-sample actions (§A.10) ──────────────────────────────────────────

  /** Collect Sample (§A.10.1). */
  @Post(':id/collect')
  @Audit(auditUpdate('Collected a sample'))
  async collect(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: CollectSampleDto,
  ) {
    return (await this.sampleService.collect([id], tenantId, personId, dto))[0];
  }

  /** Collect & Print (§A.10.1). */
  @Post(':id/collect-print')
  @Audit(auditUpdate('Collected & printed a sample'))
  async collectPrint(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: CollectSampleDto,
  ) {
    return (
      await this.sampleService.collectAndPrint([id], tenantId, personId, dto)
    )[0];
  }

  /** Accept Sample. */
  @Post(':id/accept')
  @Audit(auditUpdate('Accepted a sample'))
  async accept(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: AcceptSampleDto,
  ) {
    return (await this.sampleService.accept([id], tenantId, personId, dto))[0];
  }

  /** Acquire. */
  @Post(':id/acquire')
  @Audit(auditUpdate('Acquired a sample'))
  async acquire(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: SampleNoteDto,
  ) {
    return (await this.sampleService.acquire([id], tenantId, personId, dto))[0];
  }

  /** Hault. */
  @Post(':id/halt')
  @Audit(auditUpdate('Halted a sample'))
  async halt(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: SampleNoteDto,
  ) {
    return (await this.sampleService.halt([id], tenantId, personId, dto))[0];
  }

  /** Error. */
  @Post(':id/error')
  @Audit(auditUpdate('Flagged a sample errored'))
  async error(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: SampleNoteDto,
  ) {
    return (await this.sampleService.error([id], tenantId, personId, dto))[0];
  }

  /** Hold. */
  @Post(':id/hold')
  @Audit(auditUpdate('Held a sample'))
  async hold(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: SampleNoteDto,
  ) {
    return (await this.sampleService.hold([id], tenantId, personId, dto))[0];
  }

  /** Repeat. */
  @Post(':id/repeat')
  @Audit(auditUpdate('Flagged a sample for repeat'))
  async repeat(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: RepeatSampleDto,
  ) {
    return (await this.sampleService.repeat([id], tenantId, personId, dto))[0];
  }

  /** Store. */
  @Post(':id/store')
  @Audit(auditUpdate('Stored a sample'))
  async store(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: StoreSampleDto,
  ) {
    return (await this.sampleService.store([id], tenantId, personId, dto))[0];
  }

  /** Discard. */
  @Post(':id/discard')
  @Audit(auditUpdate('Discarded a sample'))
  async discard(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: DiscardSampleDto,
  ) {
    return (await this.sampleService.discard([id], tenantId, personId, dto))[0];
  }

  /** Return. */
  @Post(':id/return')
  @Audit(auditUpdate('Returned a sample'))
  async returnSample(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: ReturnSampleDto,
  ) {
    return (
      await this.sampleService.returnSample([id], tenantId, personId, dto)
    )[0];
  }

  /** Cancel. */
  @Post(':id/cancel')
  @Audit(auditUpdate('Cancelled a sample'))
  async cancel(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: CancelSampleDto,
  ) {
    return (await this.sampleService.cancel([id], tenantId, personId, dto))[0];
  }

  /** Retrieve (universal undo). */
  @Post(':id/retrieve')
  @Audit(auditUpdate('Retrieved a sample'))
  async retrieve(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: SampleNoteDto,
  ) {
    return (
      await this.sampleService.retrieve([id], tenantId, personId, dto)
    )[0];
  }

  /** Assign Barcode & Print (§A.10.2). */
  @Post(':id/assign-barcode')
  @Audit(auditUpdate('Assigned a barcode'))
  async assignBarcode(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: AssignBarcodeDto,
  ) {
    return (
      await this.sampleService.assignBarcode([id], tenantId, personId, dto)
    )[0];
  }

  /** Share & Inform (§A.10.20) — record a notification/document share. */
  @Post(':id/share')
  @Audit(auditUpdate('Shared a sample notification'))
  share(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: ShareSampleDto,
  ) {
    return this.sampleService.share(id, tenantId, personId, dto);
  }

  /** Update Sample (§A.10.3) — note/attachment only, no status change. */
  @Patch(':id')
  @Audit(auditUpdate('Updated a sample'))
  async update(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: SampleNoteDto,
  ) {
    return (
      await this.sampleService.updateNotes([id], tenantId, personId, dto)
    )[0];
  }
}
