import { Body, Controller, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import type { Response } from 'express';
import { LabReportService } from './lab-report.service';
import { ReRunService } from './re-run.service';
import { CriticalAlertService } from './critical-alert.service';
import { OutOfRangeService } from './out-of-range.service';
import { DeltaCheckService } from './delta-check.service';
import { ScheduledTestService } from './scheduled-test.service';
import { MultiStepProcessService } from './multi-step-process.service';
import { ListLabReportsDto } from './dto/list-lab-reports.dto';
import { UpsertResultValuesDto } from './dto/upsert-result-values.dto';
import { ReferenceRangeQueryDto } from './dto/reference-range-query.dto';
import { TrendReportQueryDto } from './dto/trend-report-query.dto';
import { PrintReportDto } from './dto/print-report.dto';
import { CreateLabReportNoteDto, ListLabReportNotesDto } from './dto/lab-report-note.dto';
import { RaiseReRunDto } from './dto/re-run.dto';
import { RaiseWorklistEntryDto } from './dto/raise-worklist-entry.dto';
import { ScheduleTestDto } from './dto/schedule-test.dto';
import {
  AdvanceMultiStepStageDto,
  AssignMultiStepProcessDto,
} from './dto/multi-step-process.dto';
import {
  ActionNotesDto,
  RequiredActionNotesDto,
} from './dto/notes-attachments.dto';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Technician Reporting endpoints (LABORATORY.docx §1-6). Business-authenticated;
 * tenant + active branch come from the JWT, never the body (CLAUDE.md §4.7).
 * Static sub-paths (`counts`) are declared before `:id` so they aren't captured
 * as ids, mirroring PhlebotomistScheduleController's ordering convention.
 */
@Controller('lab-reports')
export class LabReportController {
  constructor(
    private readonly labReportService: LabReportService,
    private readonly reRunService: ReRunService,
    private readonly criticalAlertService: CriticalAlertService,
    private readonly outOfRangeService: OutOfRangeService,
    private readonly deltaCheckService: DeltaCheckService,
    private readonly scheduledTestService: ScheduledTestService,
    private readonly multiStepProcessService: MultiStepProcessService,
  ) {}

  @Get('counts')
  getCounts(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: ListLabReportsDto,
  ) {
    return this.labReportService.getCounts(tenantId, profile.branchId, query);
  }

  @Get('options')
  getOptions(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
  ) {
    return this.labReportService.getOptions(tenantId, profile.branchId);
  }

  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: ListLabReportsDto,
  ) {
    return this.labReportService.findAll(tenantId, profile.branchId, query);
  }

  @Get(':id')
  findOne(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
  ) {
    return this.labReportService.findByIdForApi(id, tenantId, profile.branchId);
  }

  @Get(':id/history')
  getHistory(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
  ) {
    return this.labReportService.getHistory(id, tenantId, profile.branchId);
  }

  /** Order Notes / Sample Notes / Tech Notes tabs (LABORATORY.docx §4.2). */
  @Get(':id/notes')
  findNotes(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
    @Query() query: ListLabReportNotesDto,
  ) {
    return this.labReportService.findNotes(id, tenantId, profile.branchId, query);
  }

  @Post(':id/notes')
  @Audit({
    module: AuditModule.LAB_REPORT,
    action: AuditAction.CREATE,
    description: 'Added an order/sample/tech note',
  })
  createNote(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: CreateLabReportNoteDto,
  ) {
    return this.labReportService.createNote(id, tenantId, profile.branchId, personId, dto);
  }

  @Get(':id/reference-range')
  resolveReferenceRange(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
    @Query() query: ReferenceRangeQueryDto,
  ) {
    return this.labReportService.resolveReferenceRange(
      id,
      tenantId,
      profile.branchId,
      query,
    );
  }

  @Get(':id/trend')
  findTrend(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
    @Query() query: TrendReportQueryDto,
  ) {
    return this.labReportService.findTrend(id, tenantId, profile.branchId, query);
  }

  /** Print/Download Report (LABORATORY.docx §6.10). Streams the rendered PDF
   * back directly, matching `PdfReportTemplateController.generate`'s own
   * binary-response pattern (bypasses `ResponseInterceptor`'s JSON envelope). */
  @Post(':id/print')
  @Audit({
    module: AuditModule.LAB_REPORT,
    action: AuditAction.OTHER,
    description: 'Printed/downloaded a report',
  })
  async print(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
    @Body() dto: PrintReportDto,
    @Res() res: Response,
  ): Promise<void> {
    const pdf = await this.labReportService.print(
      id,
      tenantId,
      profile.branchId,
      dto.templateId,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="lab-report-${id}.pdf"`);
    res.setHeader('Content-Length', pdf.length);
    res.end(pdf);
  }

  @Patch(':id/results')
  @Audit({
    module: AuditModule.LAB_REPORT,
    action: AuditAction.UPDATE,
    description: 'Entered lab report result values',
  })
  upsertResults(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: UpsertResultValuesDto,
  ) {
    return this.labReportService.upsertResultValues(
      id,
      tenantId,
      profile.branchId,
      dto,
      personId,
    );
  }

  @Post(':id/save')
  @Audit({
    module: AuditModule.LAB_REPORT,
    action: AuditAction.UPDATE,
    description: 'Saved a lab report',
  })
  save(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
  ) {
    return this.labReportService.save(id, tenantId, profile.branchId, personId);
  }

  @Post(':id/submit')
  @Audit({
    module: AuditModule.LAB_REPORT,
    action: AuditAction.UPDATE,
    description: 'Submitted a lab report for validation',
  })
  submit(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
  ) {
    return this.labReportService.submit(id, tenantId, profile.branchId, personId);
  }

  @Post(':id/validate')
  @Audit({
    module: AuditModule.LAB_REPORT,
    action: AuditAction.UPDATE,
    description: 'Validated a lab report',
  })
  validate(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: ActionNotesDto,
  ) {
    return this.labReportService.validate(
      id,
      tenantId,
      profile.branchId,
      personId,
      dto.notes,
    );
  }

  @Post(':id/edit-report')
  @Audit({
    module: AuditModule.LAB_REPORT,
    action: AuditAction.UPDATE,
    description: 'Sent a lab report back for editing',
  })
  editReport(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
  ) {
    return this.labReportService.editReport(
      id,
      tenantId,
      profile.branchId,
      personId,
    );
  }

  @Post(':id/reject')
  @Audit({
    module: AuditModule.LAB_REPORT,
    action: AuditAction.UPDATE,
    description: 'Rejected a lab report',
  })
  reject(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: RequiredActionNotesDto,
  ) {
    return this.labReportService.reject(
      id,
      tenantId,
      profile.branchId,
      personId,
      dto.notes,
    );
  }

  @Post(':id/resubmit')
  @Audit({
    module: AuditModule.LAB_REPORT,
    action: AuditAction.UPDATE,
    description: 'Resubmitted a corrected lab report',
  })
  resubmit(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
  ) {
    return this.labReportService.resubmit(
      id,
      tenantId,
      profile.branchId,
      personId,
    );
  }

  @Post(':id/approve')
  @Audit({
    module: AuditModule.LAB_REPORT,
    action: AuditAction.UPDATE,
    description: 'Approved a lab report',
  })
  approve(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
  ) {
    return this.labReportService.approve(
      id,
      tenantId,
      profile.branchId,
      personId,
    );
  }

  @Post(':id/publish')
  @Audit({
    module: AuditModule.LAB_REPORT,
    action: AuditAction.UPDATE,
    description: 'Published a lab report',
  })
  publish(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
  ) {
    return this.labReportService.publish(
      id,
      tenantId,
      profile.branchId,
      personId,
    );
  }

  @Post(':id/error-reported')
  @Audit({
    module: AuditModule.LAB_REPORT,
    action: AuditAction.UPDATE,
    description: 'Flagged a lab report as errored',
  })
  errorReported(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: RequiredActionNotesDto,
  ) {
    return this.labReportService.errorReported(
      id,
      tenantId,
      profile.branchId,
      personId,
      dto.notes,
    );
  }

  @Post(':id/lock')
  @Audit({
    module: AuditModule.LAB_REPORT,
    action: AuditAction.UPDATE,
    description: 'Locked a lab report',
  })
  lock(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: ActionNotesDto,
  ) {
    return this.labReportService.lock(
      id,
      tenantId,
      profile.branchId,
      personId,
      dto.notes,
    );
  }

  /**
   * Unlock requires the supervisor `lab_operations:lock_override` permission.
   * TODO: wire the real permission check once the fine-grained permission-key
   * system (used elsewhere in this codebase for admin features) exposes an
   * equivalent guardable key for this module — passing `true` unconditionally
   * here would leave unlock ungated for any authenticated user. Left as an
   * explicit, named TODO rather than silently defaulting to permissive.
   */
  @Post(':id/unlock')
  @Audit({
    module: AuditModule.LAB_REPORT,
    action: AuditAction.UPDATE,
    description: 'Unlocked a lab report',
  })
  unlock(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
  ) {
    const canUnlock = false; // TODO: replace with real supervisor permission check
    return this.labReportService.unlock(id, tenantId, profile.branchId, canUnlock);
  }

  @Post(':id/update-status')
  @Audit({
    module: AuditModule.LAB_REPORT,
    action: AuditAction.UPDATE,
    description: 'Added a status update note to a lab report',
  })
  updateStatus(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: RequiredActionNotesDto,
  ) {
    return this.labReportService.updateStatus(
      id,
      tenantId,
      profile.branchId,
      personId,
      dto.notes,
    );
  }

  @Post(':id/re-run')
  @Audit({
    module: AuditModule.LAB_REPORT,
    action: AuditAction.UPDATE,
    description: 'Raised a re-run request for a lab report',
  })
  reRun(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: RaiseReRunDto,
  ) {
    return this.reRunService.raise(id, tenantId, profile.branchId, personId, dto);
  }

  @Post(':id/critical-alert')
  @Audit({
    module: AuditModule.CRITICAL_ALERT,
    action: AuditAction.CREATE,
    description: 'Raised a critical alert for a lab report',
  })
  raiseCriticalAlert(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: RaiseWorklistEntryDto,
  ) {
    return this.criticalAlertService.raise(
      id,
      tenantId,
      profile.branchId,
      personId,
      dto,
    );
  }

  @Post(':id/out-of-range')
  @Audit({
    module: AuditModule.OUT_OF_RANGE_FLAG,
    action: AuditAction.CREATE,
    description: 'Flagged a lab report result as out of range',
  })
  raiseOutOfRange(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: RaiseWorklistEntryDto,
  ) {
    return this.outOfRangeService.raise(
      id,
      tenantId,
      profile.branchId,
      personId,
      dto,
    );
  }

  @Post(':id/delta-check')
  @Audit({
    module: AuditModule.DELTA_CHECK,
    action: AuditAction.CREATE,
    description: 'Raised a delta check for a lab report',
  })
  raiseDeltaCheck(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: RaiseWorklistEntryDto,
  ) {
    return this.deltaCheckService.raise(
      id,
      tenantId,
      profile.branchId,
      personId,
      dto,
    );
  }

  @Post(':id/schedule')
  @Audit({
    module: AuditModule.SCHEDULED_TEST,
    action: AuditAction.CREATE,
    description: 'Scheduled a test',
  })
  scheduleTest(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: ScheduleTestDto,
  ) {
    return this.scheduledTestService.schedule(
      id,
      tenantId,
      profile.branchId,
      personId,
      dto,
    );
  }

  @Get(':id/multi-step-process')
  getMultiStepProcess(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
  ) {
    return this.multiStepProcessService.findByReport(id, tenantId, profile.branchId);
  }

  @Post(':id/multi-step-process')
  @Audit({
    module: AuditModule.MULTI_STEP_PROCESS,
    action: AuditAction.CREATE,
    description: 'Assigned a multi-step test process',
  })
  assignMultiStepProcess(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: AssignMultiStepProcessDto,
  ) {
    return this.multiStepProcessService.assign(
      id,
      tenantId,
      profile.branchId,
      personId,
      dto,
    );
  }

  @Post(':id/multi-step-process/advance')
  @Audit({
    module: AuditModule.MULTI_STEP_PROCESS,
    action: AuditAction.UPDATE,
    description: 'Advanced a multi-step test process stage',
  })
  advanceMultiStepProcess(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: AdvanceMultiStepStageDto,
  ) {
    return this.multiStepProcessService.advance(
      id,
      tenantId,
      profile.branchId,
      personId,
      dto,
    );
  }
}
