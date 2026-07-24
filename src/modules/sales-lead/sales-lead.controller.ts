import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { SalesLeadService } from './sales-lead.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { ListLeadsDto } from './dto/list-leads.dto';
import { UpdateLeadStatusDto } from './dto/update-lead-status.dto';
import { MeetingOutcomeDto } from './dto/meeting-outcome.dto';
import { UploadLeadDocumentDto } from './dto/upload-lead-document.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { ActiveBranchRequiredException } from './exceptions/sales-lead.exceptions';

/**
 * Business-lead endpoints (business-authenticated; tenant + active branch come
 * from the JWT). Powers Sales → Business Leads: list with all filters + status
 * buckets, the 10-section create/edit form, the lifecycle state machine, meeting
 * outcomes, documents, convert/lost, and the audit trail.
 */
@Controller('sales/leads')
export class SalesLeadController {
  constructor(private readonly leadService: SalesLeadService) {}

  /** Ensure the caller has an active branch, or throw. */
  private requireBranch(profile: ActiveProfile): string {
    if (!profile.branchId) {
      throw new ActiveBranchRequiredException();
    }
    return profile.branchId;
  }

  /** List leads (paginated + status-bucket + filters + search). */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: ListLeadsDto,
  ) {
    return this.leadService.findAll(
      tenantId,
      this.requireBranch(profile),
      query,
    );
  }

  // ── Literal routes (must precede `:id`) ──────────────────────────────────────

  /** Option lists for the Sales FE dropdowns. */
  @Get('options')
  options() {
    return this.leadService.options();
  }

  /** Create a lead (the 10-section form). */
  @Post()
  @Audit({
    module: AuditModule.SALES_LEAD,
    action: AuditAction.CREATE,
    description: 'Created a business lead',
  })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Body() dto: CreateLeadDto,
  ) {
    return this.leadService.create(
      tenantId,
      this.requireBranch(profile),
      dto,
      personId,
    );
  }

  /** Fetch one lead (with history, meetings, counts). */
  @Get(':id')
  findOne(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
  ) {
    return this.leadService.findById(id, tenantId, this.requireBranch(profile));
  }

  /** Lead status/timeline history (newest first). */
  @Get(':id/audit')
  getAudit(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
  ) {
    return this.leadService.getAudit(id, tenantId, this.requireBranch(profile));
  }

  /** Update a lead. */
  @Patch(':id')
  @Audit({
    module: AuditModule.SALES_LEAD,
    action: AuditAction.UPDATE,
    description: 'Updated a business lead',
  })
  update(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: UpdateLeadDto,
  ) {
    return this.leadService.update(
      id,
      tenantId,
      this.requireBranch(profile),
      dto,
      personId,
    );
  }

  /** Transition the lead's status (Immediate Action / manual change). */
  @Patch(':id/status')
  @Audit({
    module: AuditModule.SALES_LEAD,
    action: AuditAction.UPDATE,
    description: 'Changed a lead status',
  })
  updateStatus(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: UpdateLeadStatusDto,
  ) {
    return this.leadService.updateStatus(
      id,
      tenantId,
      this.requireBranch(profile),
      dto,
      personId,
    );
  }

  /** Record a meeting outcome (maps to the next status). */
  @Post(':id/meeting-outcome')
  @Audit({
    module: AuditModule.SALES_LEAD,
    action: AuditAction.UPDATE,
    description: 'Recorded a meeting outcome',
  })
  recordMeetingOutcome(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: MeetingOutcomeDto,
  ) {
    return this.leadService.recordMeetingOutcome(
      id,
      tenantId,
      this.requireBranch(profile),
      dto,
      personId,
    );
  }

  /** Convert a lead (status-only per this phase). */
  @Patch(':id/convert')
  @Audit({
    module: AuditModule.SALES_LEAD,
    action: AuditAction.UPDATE,
    description: 'Converted a lead',
  })
  convert(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
  ) {
    return this.leadService.convert(
      id,
      tenantId,
      this.requireBranch(profile),
      personId,
    );
  }

  /** Mark a lead Lost. */
  @Patch(':id/lost')
  @Audit({
    module: AuditModule.SALES_LEAD,
    action: AuditAction.UPDATE,
    description: 'Marked a lead lost',
  })
  markLost(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
  ) {
    return this.leadService.markLost(
      id,
      tenantId,
      this.requireBranch(profile),
      personId,
    );
  }

  /** Attach a proposal/quotation/agreement document URL. */
  @Post(':id/documents')
  @Audit({
    module: AuditModule.SALES_LEAD,
    action: AuditAction.UPDATE,
    description: 'Uploaded a lead document',
  })
  uploadDocument(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: UploadLeadDocumentDto,
  ) {
    return this.leadService.uploadDocument(
      id,
      tenantId,
      this.requireBranch(profile),
      dto,
      personId,
    );
  }

  /** Soft-delete a lead. */
  @Delete(':id')
  @Audit({
    module: AuditModule.SALES_LEAD,
    action: AuditAction.DELETE,
    description: 'Deleted a business lead',
  })
  remove(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
  ) {
    return this.leadService.remove(id, tenantId, this.requireBranch(profile));
  }
}
