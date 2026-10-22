import { forwardRef, Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PdfModule } from '../pdf/pdf.module';
import { PdfReportTemplateModule } from '../pdf-report-template/pdf-report-template.module';
import { OrderModule } from '../order/order.module';
import { RadiologyController } from './radiology.controller';
import { RadiologyCertificateIssueController } from './radiology-certificate-issue.controller';
import { RadiologyStudyService } from './radiology-study.service';
import { RadiologyPrintService } from './radiology-print.service';
import { RadiologyAllReportService } from './radiology-all-report.service';
import { RadiologyCertificateIssueService } from './radiology-certificate-issue.service';

/**
 * Radiology processing module (New Radiology Flow, Phase 3). Owns the radiology
 * worklist (`RadiologyStudy`) and its lifecycle state machine. Exports
 * `RadiologyStudyService` so `OrderModule` can inject it to generate studies when
 * a radiology order is confirmed (the order → radiology handoff, parallel to the
 * accession sample handoff but skipping specimen collection).
 */
@Module({
  imports: [
    PrismaModule,
    PdfModule,
    PdfReportTemplateModule,
    // forwardRef: OrderModule imports RadiologyModule (order → radiology study
    // handoff); the radiology print services reuse OrderService.getBillVariables
    // for billing tags, so the dependency is mutual.
    forwardRef(() => OrderModule),
  ],
  controllers: [RadiologyController, RadiologyCertificateIssueController],
  providers: [
    RadiologyStudyService,
    RadiologyPrintService,
    RadiologyAllReportService,
    RadiologyCertificateIssueService,
  ],
  exports: [RadiologyStudyService],
})
export class RadiologyModule {}
