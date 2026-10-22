import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { RadiologyStudyService } from './radiology-study.service';
import { RadiologyPrintService } from './radiology-print.service';
import { RadiologyAllReportService } from './radiology-all-report.service';
import { ListRadiologyStudiesDto } from './dto/list-radiology-studies.dto';
import { RadiologyStudyActionDto } from './dto/radiology-study-action.dto';
import { ReportRadiologyStudyDto } from './dto/report-radiology-study.dto';
import { BulkRadiologyActionDto } from './dto/bulk-radiology-action.dto';
import { PrintRadiologyAllDto } from './dto/print-radiology-all.dto';

/**
 * Radiology processing worklist (`/radiology/studies`). Business-authenticated;
 * tenant from the JWT, active branch from the JWT profile. The radiology study
 * lifecycle (schedule → acquire → report → validate → approve → publish, plus
 * hold/cancel/retrieve) is driven through the action endpoints. Mirrors the
 * accession controller shape, for the imaging/report pipeline.
 */
@Controller('radiology/studies')
export class RadiologyController {
  constructor(
    private readonly service: RadiologyStudyService,
    private readonly printService: RadiologyPrintService,
    private readonly allReportService: RadiologyAllReportService,
  ) {}

  /**
   * Stream the study's report PDF (resolves the radiology_report template, builds
   * the merge variables from the study + order/patient). Uses the Express
   * response directly, so the global envelope interceptor is bypassed.
   */
  @Get(':id/print')
  async print(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
    @Query('templateId') templateId: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const pdf = await this.printService.generateStudyPdf(
      id,
      tenantId,
      profile.branchId ?? null,
      templateId,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="radiology-${id}.pdf"`,
    );
    res.setHeader('Content-Length', pdf.length);
    res.end(pdf);
  }

  /**
   * Stream a COMBINED report PDF for several selected studies (the worklist's
   * multi-select "Print Report"). Renders the chosen (or centrally-resolved)
   * `radiology_all_report` template once over every study, each study's report
   * body combined into one document. Declared before the `:id` routes so
   * `studies/print-all` isn't captured as a study id. Streams the PDF directly,
   * matching `:id/print`.
   */
  @Post('print-all')
  async printAll(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Body() dto: PrintRadiologyAllDto,
    @Res() res: Response,
  ): Promise<void> {
    const pdf = await this.allReportService.generateAllStudiesPdf(
      dto.studyIds,
      tenantId,
      profile.branchId ?? null,
      dto.templateId,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      'inline; filename="radiology-all-reports.pdf"',
    );
    res.setHeader('Content-Length', pdf.length);
    res.end(pdf);
  }

  /** Paginated worklist (tenant + active branch), with search/status/modality filters. */
  @Get()
  list(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: ListRadiologyStudiesDto,
  ) {
    return this.service.findAll(tenantId, profile.branchId ?? null, query);
  }

  /** Per-status counts for the worklist summary cards. */
  @Get('summary')
  summary(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
  ) {
    return this.service.summary(tenantId, profile.branchId ?? null);
  }

  /** Apply one status action to several studies at once. */
  @Post('bulk')
  bulk(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Body() dto: BulkRadiologyActionDto,
  ) {
    return this.service.bulkTransition(
      dto.ids,
      tenantId,
      profile.branchId ?? null,
      personId,
      dto.action,
      dto,
    );
  }

  /** Fetch one study with its status history. */
  @Get(':id')
  get(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.findById(id, tenantId);
  }

  /** The study's status history (audit trail). */
  @Get(':id/history')
  history(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.getHistory(id, tenantId);
  }

  @Post(':id/schedule')
  schedule(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: RadiologyStudyActionDto,
  ) {
    return this.service.transition(
      id,
      tenantId,
      profile.branchId ?? null,
      personId,
      'schedule',
      dto,
    );
  }

  @Post(':id/acquire')
  acquire(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: RadiologyStudyActionDto,
  ) {
    return this.service.transition(
      id,
      tenantId,
      profile.branchId ?? null,
      personId,
      'acquire',
      dto,
    );
  }

  /** Fill or edit the narrative report (findings / impression / recommendation). */
  @Post(':id/report')
  report(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: ReportRadiologyStudyDto,
  ) {
    return this.service.transition(
      id,
      tenantId,
      profile.branchId ?? null,
      personId,
      'report',
      dto,
    );
  }

  @Post(':id/validate')
  validate(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: RadiologyStudyActionDto,
  ) {
    return this.service.transition(
      id,
      tenantId,
      profile.branchId ?? null,
      personId,
      'validate',
      dto,
    );
  }

  @Post(':id/approve')
  approve(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: RadiologyStudyActionDto,
  ) {
    return this.service.transition(
      id,
      tenantId,
      profile.branchId ?? null,
      personId,
      'approve',
      dto,
    );
  }

  @Post(':id/publish')
  publish(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: RadiologyStudyActionDto,
  ) {
    return this.service.transition(
      id,
      tenantId,
      profile.branchId ?? null,
      personId,
      'publish',
      dto,
    );
  }

  @Post(':id/hold')
  hold(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: RadiologyStudyActionDto,
  ) {
    return this.service.transition(
      id,
      tenantId,
      profile.branchId ?? null,
      personId,
      'hold',
      dto,
    );
  }

  @Post(':id/cancel')
  cancel(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: RadiologyStudyActionDto,
  ) {
    return this.service.transition(
      id,
      tenantId,
      profile.branchId ?? null,
      personId,
      'cancel',
      dto,
    );
  }

  /** Universal undo — revert a held study to its previous status. */
  @Post(':id/retrieve')
  retrieve(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: RadiologyStudyActionDto,
  ) {
    return this.service.transition(
      id,
      tenantId,
      profile.branchId ?? null,
      personId,
      'retrieve',
      dto,
    );
  }
}
