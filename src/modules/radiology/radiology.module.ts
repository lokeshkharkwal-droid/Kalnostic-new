import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PdfReportTemplateModule } from '../pdf-report-template/pdf-report-template.module';
import { RadiologyController } from './radiology.controller';
import { RadiologyStudyService } from './radiology-study.service';
import { RadiologyPrintService } from './radiology-print.service';

/**
 * Radiology processing module (New Radiology Flow, Phase 3). Owns the radiology
 * worklist (`RadiologyStudy`) and its lifecycle state machine. Exports
 * `RadiologyStudyService` so `OrderModule` can inject it to generate studies when
 * a radiology order is confirmed (the order → radiology handoff, parallel to the
 * accession sample handoff but skipping specimen collection).
 */
@Module({
  imports: [PrismaModule, PdfReportTemplateModule],
  controllers: [RadiologyController],
  providers: [RadiologyStudyService, RadiologyPrintService],
  exports: [RadiologyStudyService],
})
export class RadiologyModule {}
