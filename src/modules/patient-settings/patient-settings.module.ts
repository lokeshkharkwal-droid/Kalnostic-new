import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PatientSettingsController } from './patient-settings.controller';
import { PatientSettingsService } from './patient-settings.service';

/** Patient settings module for Registration patient identity/consent settings. */
@Module({
  imports: [PrismaModule],
  controllers: [PatientSettingsController],
  providers: [PatientSettingsService],
  exports: [PatientSettingsService],
})
export class PatientSettingsModule {}
