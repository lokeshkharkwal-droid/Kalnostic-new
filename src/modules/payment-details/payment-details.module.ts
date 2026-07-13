import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PaymentDetailsController } from './payment-details.controller';
import { PaymentDetailsService } from './payment-details.service';

/**
 * Payment ledger module (`/payments`). Tenant-scoped + branch-level CRUD against
 * an order's payment records. Exports `PaymentDetailsService` for reuse.
 */
@Module({
  imports: [PrismaModule],
  controllers: [PaymentDetailsController],
  providers: [PaymentDetailsService],
  exports: [PaymentDetailsService],
})
export class PaymentDetailsModule {}
