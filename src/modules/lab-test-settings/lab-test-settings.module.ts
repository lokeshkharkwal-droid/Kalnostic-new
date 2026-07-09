import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { LabTestSettingsController } from './lab-test-settings.controller';
import { LabTestSettingsService } from './lab-test-settings.service';

@Module({
  imports: [PrismaModule],
  controllers: [LabTestSettingsController],
  providers: [LabTestSettingsService],
  exports: [LabTestSettingsService],
})
export class LabTestSettingsModule {}
