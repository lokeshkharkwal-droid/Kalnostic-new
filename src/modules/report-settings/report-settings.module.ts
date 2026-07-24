import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ReportSettingsController } from './report-settings.controller';
import { ReportSettingsService } from './report-settings.service';

/** Report settings module for Registration report header/signature/publishing settings. */
@Module({
  imports: [PrismaModule],
  controllers: [ReportSettingsController],
  providers: [ReportSettingsService],
  exports: [ReportSettingsService],
})
export class ReportSettingsModule {}
