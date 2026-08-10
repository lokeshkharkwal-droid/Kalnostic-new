import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BranchModule } from '../branch/branch.module';
import { RegistrationSettingsController } from './registration-settings.controller';
import { RegistrationSettingsService } from './registration-settings.service';
import { RegistrationIdSequenceController } from './registration-id-sequence.controller';
import { RegistrationIdSequenceService } from './registration-id-sequence.service';
import { ExternalIdService } from './external-id.service';

@Module({
  imports: [PrismaModule, BranchModule],
  controllers: [
    RegistrationSettingsController,
    RegistrationIdSequenceController,
  ],
  providers: [
    RegistrationSettingsService,
    RegistrationIdSequenceService,
    ExternalIdService,
  ],
  exports: [
    RegistrationSettingsService,
    RegistrationIdSequenceService,
    ExternalIdService,
  ],
})
export class RegistrationSettingsModule {}
