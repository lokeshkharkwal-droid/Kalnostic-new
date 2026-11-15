import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BranchModule } from '../branch/branch.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { TenantTimeZoneModule } from '../tenant/tenant-timezone.module';
import { RegistrationSettingsController } from './registration-settings.controller';
import { RegistrationSettingsService } from './registration-settings.service';
import { RegistrationIdSequenceController } from './registration-id-sequence.controller';
import { RegistrationIdSequenceService } from './registration-id-sequence.service';
import { ExternalIdService } from './external-id.service';
import { EmergencyPricingService } from './emergency-pricing.service';

@Module({
  imports: [
    PrismaModule,
    BranchModule,
    PermissionsModule,
    TenantTimeZoneModule,
  ],
  controllers: [
    RegistrationSettingsController,
    RegistrationIdSequenceController,
  ],
  providers: [
    RegistrationSettingsService,
    RegistrationIdSequenceService,
    ExternalIdService,
    EmergencyPricingService,
  ],
  exports: [
    RegistrationSettingsService,
    RegistrationIdSequenceService,
    ExternalIdService,
    EmergencyPricingService,
  ],
})
export class RegistrationSettingsModule {}
