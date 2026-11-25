import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { PatientTransactionService } from './patient-transaction.service';
import { ListPatientTransactionsDto } from './dto/list-patient-transactions.dto';
import { PatientJwtGuard } from '../patient-auth/guards/patient-jwt.guard';
import { CurrentPatient } from '../patient-auth/decorators/current-patient.decorator';
import { Public } from '../auth/decorators/public.decorator';

/**
 * Patient-facing transaction history (read-only). `@Public()` bypasses the global
 * business guard; `PatientJwtGuard` authenticates via the `'jwt-patient'`
 * strategy. **Person-scoped, cross-business:** every read is scoped to the
 * session's person across EVERY business they belong to; the detail read
 * re-enters the business carried on the row (`tenantId`). Ownership is enforced in
 * the service — a patient can never reach another patient's transaction by
 * changing an id.
 */
@Public()
@UseGuards(PatientJwtGuard)
@Controller('patient-portal')
export class PatientTransactionController {
  constructor(
    private readonly patientTransactionService: PatientTransactionService,
  ) {}

  /** Paginated transaction list across all businesses (optional date filter). */
  @Get('transactions')
  listTransactions(
    @CurrentPatient('person_id') personId: string,
    @Query() query: ListPatientTransactionsDto,
  ) {
    return this.patientTransactionService.listTransactions(personId, {
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      page: query.page ?? 1,
      limit: query.limit ?? 10,
    });
  }

  /**
   * One transaction's full detail (order context + payment facts). Owner-checked;
   * `tenantId` (the business the transaction belongs to) comes from the list row.
   */
  @Get('transactions/:id')
  getTransaction(
    @CurrentPatient('person_id') personId: string,
    @Query('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.patientTransactionService.getTransactionDetail(
      personId,
      tenantId,
      id,
    );
  }
}
