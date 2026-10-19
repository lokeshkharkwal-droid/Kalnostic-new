import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { RadiologyStudyService } from './radiology-study.service';
import { RadiologyPrintService } from './radiology-print.service';
import { ListRadiologyStudiesDto } from './dto/list-radiology-studies.dto';
import { RadiologyStudyActionDto } from './dto/radiology-study-action.dto';
import { ReportRadiologyStudyDto } from './dto/report-radiology-study.dto';
import { BulkRadiologyActionDto } from './dto/bulk-radiology-action.dto';

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
    @Res() res: Response,
  ): Promise<void> {
    const pdf = await this.printService.generateStudyPdf(
      id,
      tenantId,
      profile.branchId ?? null,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="radiology-${id}.pdf"`,
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
    @CurrentUser('person_id') personId: string,
    @Body() dto: BulkRadiologyActionDto,
  ) {
    return this.service.bulkTransition(
      dto.ids,
      tenantId,
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
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: RadiologyStudyActionDto,
  ) {
    return this.service.transition(id, tenantId, personId, 'schedule', dto);
  }

  @Post(':id/acquire')
  acquire(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: RadiologyStudyActionDto,
  ) {
    return this.service.transition(id, tenantId, personId, 'acquire', dto);
  }

  /** Fill or edit the narrative report (findings / impression / recommendation). */
  @Post(':id/report')
  report(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: ReportRadiologyStudyDto,
  ) {
    return this.service.transition(id, tenantId, personId, 'report', dto);
  }

  @Post(':id/validate')
  validate(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: RadiologyStudyActionDto,
  ) {
    return this.service.transition(id, tenantId, personId, 'validate', dto);
  }

  @Post(':id/approve')
  approve(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: RadiologyStudyActionDto,
  ) {
    return this.service.transition(id, tenantId, personId, 'approve', dto);
  }

  @Post(':id/publish')
  publish(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: RadiologyStudyActionDto,
  ) {
    return this.service.transition(id, tenantId, personId, 'publish', dto);
  }

  @Post(':id/hold')
  hold(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: RadiologyStudyActionDto,
  ) {
    return this.service.transition(id, tenantId, personId, 'hold', dto);
  }

  @Post(':id/cancel')
  cancel(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: RadiologyStudyActionDto,
  ) {
    return this.service.transition(id, tenantId, personId, 'cancel', dto);
  }

  /** Universal undo — revert a held study to its previous status. */
  @Post(':id/retrieve')
  retrieve(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: RadiologyStudyActionDto,
  ) {
    return this.service.transition(id, tenantId, personId, 'retrieve', dto);
  }
}
