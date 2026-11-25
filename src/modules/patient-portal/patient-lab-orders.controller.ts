import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentPatient } from '../patient-auth/decorators/current-patient.decorator';
import { PatientJwtGuard } from '../patient-auth/guards/patient-jwt.guard';
import { ListPatientLabOrdersQueryDto } from './dto/list-patient-lab-orders-query.dto';
import { PatientLabOrdersService } from './patient-lab-orders.service';

/**
 * The patient's lab orders (read-only): list, detail and PUBLISHED report PDFs.
 * Same guard setup as the rest of the portal — `@Public()` opts out of the
 * global staff `JwtAuthGuard`, `PatientJwtGuard` authenticates the patient
 * token. Tenant and person always come from the token, never from the request.
 */
@Public()
@UseGuards(PatientJwtGuard)
@Controller('patient-portal/lab-orders')
export class PatientLabOrdersController {
  constructor(private readonly labOrdersService: PatientLabOrdersService) {}

  /**
   * The patient's lab orders, newest first, with optional family-member,
   * search and date filters (offset pagination).
   */
  @Get()
  list(
    @CurrentPatient('tenant_id') tenantId: string,
    @CurrentPatient('person_id') personId: string,
    @Query() query: ListPatientLabOrdersQueryDto,
  ) {
    return this.labOrdersService.list(tenantId, personId, query);
  }

  /** One lab order with its per-test report rows. */
  @Get(':orderId')
  detail(
    @CurrentPatient('tenant_id') tenantId: string,
    @CurrentPatient('person_id') personId: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    return this.labOrdersService.getDetail(tenantId, personId, orderId);
  }

  /**
   * All PUBLISHED reports of the order as one merged PDF. Streamed with the
   * library response so the envelope interceptor does not wrap the binary.
   */
  @Get(':orderId/reports.pdf')
  async allReports(
    @CurrentPatient('tenant_id') tenantId: string,
    @CurrentPatient('person_id') personId: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Res() res: Response,
  ): Promise<void> {
    const { pdf, fileName } = await this.labOrdersService.getAllReportsPdf(
      tenantId,
      personId,
      orderId,
    );
    this.streamPdf(res, pdf, fileName);
  }

  /** One PUBLISHED report as a PDF (must belong to this order). */
  @Get(':orderId/reports/:reportId/pdf')
  async oneReport(
    @CurrentPatient('tenant_id') tenantId: string,
    @CurrentPatient('person_id') personId: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Param('reportId', ParseUUIDPipe) reportId: string,
    @Res() res: Response,
  ): Promise<void> {
    const { pdf, fileName } = await this.labOrdersService.getReportPdf(
      tenantId,
      personId,
      orderId,
      reportId,
    );
    this.streamPdf(res, pdf, fileName);
  }

  /** Write a PDF buffer inline, unwrapped by the envelope interceptor. */
  private streamPdf(res: Response, pdf: Buffer, fileName: string): void {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    res.setHeader('Content-Length', pdf.length);
    res.end(pdf);
  }
}
