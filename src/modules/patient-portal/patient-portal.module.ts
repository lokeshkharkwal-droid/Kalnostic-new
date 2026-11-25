import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PatientAuthModule } from '../patient-auth/patient-auth.module';
import { OrderModule } from '../order/order.module';
import { PdfReportTemplateModule } from '../pdf-report-template/pdf-report-template.module';
import { PatientPortalController } from './patient-portal.controller';
import { PatientBillingController } from './patient-billing.controller';
import { PatientTransactionController } from './patient-transaction.controller';
import { PatientPortalService } from './patient-portal.service';
import { PatientBillingService } from './patient-billing.service';
import { PatientTransactionService } from './patient-transaction.service';

/**
 * Patient-portal data module (home summary, business list, billing). Imports
 * `PatientAuthModule` for the `'jwt-patient'` strategy behind `PatientJwtGuard`,
 * `OrderModule` (`OrderService.print` for the bill PDF) and
 * `PdfReportTemplateModule` (resolve the `bill_print` template) so the patient
 * bill reuses the exact staff order rollups + print engine.
 */
@Module({
  imports: [
    PrismaModule,
    PatientAuthModule,
    OrderModule,
    PdfReportTemplateModule,
  ],
  controllers: [
    PatientPortalController,
    PatientBillingController,
    PatientTransactionController,
  ],
  providers: [
    PatientPortalService,
    PatientBillingService,
    PatientTransactionService,
  ],
  exports: [PatientPortalService],
})
export class PatientPortalModule {}
