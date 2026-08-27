import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { BillingSettingsController } from './billing-settings.controller';
import { BillingSettingsService } from './billing-settings.service';

/** Billing settings module for Registration invoice/payment/refund settings. */
@Module({
  imports: [PrismaModule, PermissionsModule],
  controllers: [BillingSettingsController],
  providers: [BillingSettingsService],
  exports: [BillingSettingsService],
})
export class BillingSettingsModule {}
