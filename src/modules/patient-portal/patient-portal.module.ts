import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { LabReportModule } from '../lab-report/lab-report.module';
import { OrderModule } from '../order/order.module';
import { PatientAuthModule } from '../patient-auth/patient-auth.module';
import { PdfReportTemplateModule } from '../pdf-report-template/pdf-report-template.module';
import { TenantModule } from '../tenant/tenant.module';
import { PatientBillingController } from './patient-billing.controller';
import { PatientBillingService } from './patient-billing.service';
import { PatientLabOrdersController } from './patient-lab-orders.controller';
import { PatientLabOrdersService } from './patient-lab-orders.service';
import { PatientPortalController } from './patient-portal.controller';
import { PatientPortalService } from './patient-portal.service';
import { PatientScopeService } from './patient-scope.service';
import { PatientTransactionController } from './patient-transaction.controller';
import { PatientTransactionService } from './patient-transaction.service';

/**
 * Patient-portal data module: home summary, business list, the viewable-patient
 * (family) list, the read-only lab orders, billing and transactions. Imports
 * `PatientAuthModule` so the `'jwt-patient'` strategy backing `PatientJwtGuard`
 * is registered when these routes authenticate; `LabReportModule` supplies the
 * report PDF rendering, `TenantModule` the business's display locale, and
 * `OrderModule` (`OrderService.print` for the bill PDF) with
 * `PdfReportTemplateModule` (resolve the `bill_print` template) let the patient
 * bill reuse the exact staff order rollups + print engine.
 */
@Module({
  imports: [
    PrismaModule,
    PatientAuthModule,
    LabReportModule,
    OrderModule,
    PdfReportTemplateModule,
    TenantModule,
  ],
  controllers: [
    PatientPortalController,
    PatientLabOrdersController,
    PatientBillingController,
    PatientTransactionController,
  ],
  providers: [
    PatientPortalService,
    PatientScopeService,
    PatientLabOrdersService,
    PatientBillingService,
    PatientTransactionService,
  ],
  exports: [PatientPortalService, PatientScopeService],
})
export class PatientPortalModule {}
