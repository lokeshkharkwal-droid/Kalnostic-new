import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { OverallResultTemplateController } from './overall-result-template.controller';
import { OverallResultTemplateService } from './overall-result-template.service';

/**
 * Overall-result-template feature module. Tenant-scoped, tenant-level
 * (CLAUDE.md §4.6). Imports only `PrismaModule` — no cross-module validation
 * needed for phase 1 (report-time consumption is a future phase).
 */
@Module({
  imports: [PrismaModule],
  controllers: [OverallResultTemplateController],
  providers: [OverallResultTemplateService],
  exports: [OverallResultTemplateService],
})
export class OverallResultTemplateModule {}
