import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { PatientTransactionService } from './patient-transaction.service';
import { ListPatientTransactionsDto } from './dto/list-patient-transactions.dto';
import { PatientJwtGuard } from '../patient-auth/guards/patient-jwt.guard';
import { CurrentPatient } from '../patient-auth/decorators/current-patient.decorator';
import { Public } from '../auth/decorators/public.decorator';

/**
 * Patient-facing transaction history (read-only). `@Public()` bypasses the global
 * business guard; `PatientJwtGuard` authenticates via the `'jwt-patient'`
 * strategy, so the tenant RLS context applies and every read is scoped to the
 * session's person + tenant across all branches. Ownership is enforced in the
 * service — a patient can never reach another patient's transaction by changing
 * an id.
 */
@Public()
@UseGuards(PatientJwtGuard)
@Controller('patient-portal')
export class PatientTransactionController {
  constructor(
    private readonly patientTransactionService: PatientTransactionService,
  ) {}

  /** Paginated transaction list (optional date-range filter; all branches). */
  @Get('transactions')
  listTransactions(
    @CurrentPatient('tenant_id') tenantId: string,
    @CurrentPatient('person_id') personId: string,
    @Query() query: ListPatientTransactionsDto,
  ) {
    return this.patientTransactionService.listTransactions(tenantId, personId, {
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      page: query.page ?? 1,
      limit: query.limit ?? 10,
    });
  }

  /** One transaction's full detail (order context + payment facts). Owner-checked. */
  @Get('transactions/:id')
  getTransaction(
    @CurrentPatient('tenant_id') tenantId: string,
    @CurrentPatient('person_id') personId: string,
    @Param('id') id: string,
  ) {
    return this.patientTransactionService.getTransactionDetail(
      tenantId,
      personId,
      id,
    );
  }
}
