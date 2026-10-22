import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { RadiologyCertificateIssueService } from './radiology-certificate-issue.service';
import { PreviewRadiologyCertificateDto } from './dto/preview-radiology-certificate.dto';
import { IssueRadiologyCertificateDto } from './dto/issue-radiology-certificate.dto';
import { RenderRadiologyCertificateDto } from './dto/render-radiology-certificate.dto';
import { UpdateIssuedRadiologyCertificateDto } from './dto/update-issued-radiology-certificate.dto';

/**
 * Issue / view / print radiology certificates against a study
 * (`/radiology/studies/:studyId/certificates`). The second tier ported from
 * EzHealthTrack: pick a `RadiologyCertificate` template → the server fills its
 * `{placeholder}`s from the study/patient context → the doctor edits → issue →
 * print. Business-authenticated; tenant + active branch come from the JWT.
 */
@Controller('radiology/studies/:studyId/certificates')
export class RadiologyCertificateIssueController {
  constructor(private readonly service: RadiologyCertificateIssueService) {}

  /** List certificates issued against the study (newest first). */
  @Get()
  list(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('studyId') studyId: string,
  ) {
    return this.service.listForStudy(
      tenantId,
      profile.branchId ?? null,
      studyId,
    );
  }

  /** Render a template against the study WITHOUT saving (returns resolved HTML). */
  @Post('preview')
  @HttpCode(HttpStatus.OK)
  preview(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('studyId') studyId: string,
    @Body() dto: PreviewRadiologyCertificateDto,
  ) {
    return this.service.preview(
      tenantId,
      profile.branchId ?? null,
      studyId,
      dto.certificateId,
      dto.reportingDoctorId,
    );
  }

  /**
   * Render a certificate against the study to a PDF WITHOUT saving — the
   * worklist "Print Certificate" action. Streams the PDF (bypasses the envelope
   * interceptor); an optional `findings` override reflects the report body the
   * doctor is editing before it is saved onto the study.
   */
  @Post('render')
  @HttpCode(HttpStatus.OK)
  async render(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('studyId') studyId: string,
    @Body() dto: RenderRadiologyCertificateDto,
    @Res() res: Response,
  ): Promise<void> {
    const { pdf } = await this.service.renderUnsaved(
      tenantId,
      profile.branchId ?? null,
      studyId,
      dto.content,
      dto.certificateId,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="radiology-certificate-${studyId}.pdf"`,
    );
    res.setHeader('Content-Length', pdf.length);
    res.end(pdf);
  }

  /** Issue (save) a certificate against the study. */
  @Post()
  issue(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('studyId') studyId: string,
    @Body() dto: IssueRadiologyCertificateDto,
  ) {
    return this.service.issue(
      tenantId,
      profile.branchId ?? null,
      studyId,
      personId,
      dto,
    );
  }

  /** Stream an issued certificate as a PDF (bypasses the envelope interceptor). */
  @Get(':issuedId/print')
  async print(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('issuedId') issuedId: string,
    @Res() res: Response,
  ): Promise<void> {
    const pdf = await this.service.printIssued(
      tenantId,
      profile.branchId ?? null,
      issuedId,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="radiology-certificate-${issuedId}.pdf"`,
    );
    res.setHeader('Content-Length', pdf.length);
    res.end(pdf);
  }

  /** Fetch one issued certificate. */
  @Get(':issuedId')
  getOne(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('issuedId') issuedId: string,
  ) {
    return this.service.getIssued(tenantId, profile.branchId ?? null, issuedId);
  }

  /** Re-edit an issued certificate's HTML. */
  @Patch(':issuedId')
  update(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('issuedId') issuedId: string,
    @Body() dto: UpdateIssuedRadiologyCertificateDto,
  ) {
    return this.service.updateIssued(
      tenantId,
      profile.branchId ?? null,
      issuedId,
      personId,
      dto,
    );
  }

  /** Soft-delete (revoke) an issued certificate. */
  @Delete(':issuedId')
  remove(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('issuedId') issuedId: string,
  ) {
    return this.service.removeIssued(
      tenantId,
      profile.branchId ?? null,
      issuedId,
      personId,
    );
  }
}
