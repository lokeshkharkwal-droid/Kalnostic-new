import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { PatientBillingService } from './patient-billing.service';
import { ListPatientBillsDto } from './dto/list-patient-bills.dto';
import { PatientJwtGuard } from '../patient-auth/guards/patient-jwt.guard';
import { CurrentPatient } from '../patient-auth/decorators/current-patient.decorator';
import { Public } from '../auth/decorators/public.decorator';

/**
 * Patient-facing billing (read + print). `@Public()` bypasses the global business
 * guard; `PatientJwtGuard` authenticates via the `'jwt-patient'` strategy.
 * **Person-scoped, cross-business:** every read is scoped to the session's person
 * across EVERY business they belong to; the detail/PDF reads re-enter the business
 * carried on the row (`tenantId`). Ownership is enforced in the service — a patient
 * can never reach another patient's bill by changing an id.
 */
@Public()
@UseGuards(PatientJwtGuard)
@Controller('patient-portal')
export class PatientBillingController {
  constructor(private readonly patientBillingService: PatientBillingService) {}

  /** Paginated bill list across all businesses (filters: date, business, status). */
  @Get('bills')
  listBills(
    @CurrentPatient('person_id') personId: string,
    @Query() query: ListPatientBillsDto,
  ) {
    return this.patientBillingService.listBills(personId, {
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      tenantId: query.tenantId,
      billStatus: query.billStatus,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    });
  }

  /**
   * One bill's full detail (items, transactions, summary). Owner-checked;
   * `tenantId` (the business the bill belongs to) comes from the list row.
   */
  @Get('bills/:orderId')
  getBill(
    @CurrentPatient('person_id') personId: string,
    @Query('tenantId') tenantId: string,
    @Param('orderId') orderId: string,
  ) {
    return this.patientBillingService.getBillDetail(
      personId,
      tenantId,
      orderId,
    );
  }

  /** Render the bill as a PDF (bill_print template). Owner-checked. */
  @Get('bills/:orderId/pdf')
  async getBillPdf(
    @CurrentPatient('person_id') personId: string,
    @Query('tenantId') tenantId: string,
    @Param('orderId') orderId: string,
    @Res() res: Response,
  ): Promise<void> {
    const pdf = await this.patientBillingService.getBillPdf(
      personId,
      tenantId,
      orderId,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="bill-${orderId}.pdf"`,
    );
    res.setHeader('Content-Length', pdf.length);
    res.end(pdf);
  }
}
