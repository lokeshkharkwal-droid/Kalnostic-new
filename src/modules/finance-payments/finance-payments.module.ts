import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { FinancePaymentsController } from './finance-payments.controller';
import { FinancePaymentsService } from './finance-payments.service';

/**
 * Finance → Payments consolidated ledger (`/finance/payments`). Read-only
 * aggregation over order payments (`PaymentDetails`) and invoice receipts
 * (`InvoicePayment`); no writes, so it only needs Prisma.
 */
@Module({
  imports: [PrismaModule],
  controllers: [FinancePaymentsController],
  providers: [FinancePaymentsService],
})
export class FinancePaymentsModule {}
