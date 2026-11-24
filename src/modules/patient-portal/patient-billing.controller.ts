import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { PatientBillingService } from './patient-billing.service';
import {
  ListPatientBillsDto,
  ListPatientBranchesDto,
} from './dto/list-patient-bills.dto';
import { PatientJwtGuard } from '../patient-auth/guards/patient-jwt.guard';
import { CurrentPatient } from '../patient-auth/decorators/current-patient.decorator';
import { Public } from '../auth/decorators/public.decorator';

/**
 * Patient-facing billing (read + print). `@Public()` bypasses the global business
 * guard; `PatientJwtGuard` authenticates via the `'jwt-patient'` strategy, so the
 * tenant RLS context applies and every read is scoped to the session's person +
 * tenant across all branches. Ownership is enforced in the service — a patient
 * can never reach another patient's bill by changing an id.
 */
@Public()
@UseGuards(PatientJwtGuard)
@Controller('patient-portal')
export class PatientBillingController {
  constructor(private readonly patientBillingService: PatientBillingService) {}

  /** Paginated bill list (filters: date range, branch, bill status). */
  @Get('bills')
  listBills(
    @CurrentPatient('tenant_id') tenantId: string,
    @CurrentPatient('person_id') personId: string,
    @Query() query: ListPatientBillsDto,
  ) {
    return this.patientBillingService.listBills(tenantId, personId, {
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      branchId: query.branchId,
      billStatus: query.billStatus,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    });
  }

  /** The branch options for the filter dropdown (searchable, paginated). */
  @Get('branches')
  listBranches(
    @CurrentPatient('tenant_id') tenantId: string,
    @Query() query: ListPatientBranchesDto,
  ) {
    return this.patientBillingService.listBranches(tenantId, query);
  }

  /** One bill's full detail (items, transactions, summary). Owner-checked. */
  @Get('bills/:orderId')
  getBill(
    @CurrentPatient('tenant_id') tenantId: string,
    @CurrentPatient('person_id') personId: string,
    @Param('orderId') orderId: string,
  ) {
    return this.patientBillingService.getBillDetail(
      tenantId,
      personId,
      orderId,
    );
  }

  /** Render the bill as a PDF (bill_print template). Owner-checked. */
  @Get('bills/:orderId/pdf')
  async getBillPdf(
    @CurrentPatient('tenant_id') tenantId: string,
    @CurrentPatient('person_id') personId: string,
    @Param('orderId') orderId: string,
    @Res() res: Response,
  ): Promise<void> {
    const pdf = await this.patientBillingService.getBillPdf(
      tenantId,
      personId,
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
