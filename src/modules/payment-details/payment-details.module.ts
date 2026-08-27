import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { RegistrationSettingsModule } from '../registration-settings/registration-settings.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { PaymentDetailsController } from './payment-details.controller';
import { PaymentDetailsService } from './payment-details.service';

/**
 * Payment ledger module (`/payments`). Tenant-scoped + branch-level CRUD against
 * an order's payment records. Exports `PaymentDetailsService` for reuse.
 * Imports `RegistrationSettingsModule` for the collection-by-other-user gate.
 */
@Module({
  imports: [PrismaModule, PermissionsModule, RegistrationSettingsModule],
  controllers: [PaymentDetailsController],
  providers: [PaymentDetailsService],
  exports: [PaymentDetailsService],
})
export class PaymentDetailsModule {}
