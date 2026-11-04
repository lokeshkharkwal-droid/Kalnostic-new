import { Module } from '@nestjs/common';
import { PublicController } from './public.controller';
import { PublicService } from './public.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { TenantModule } from '../tenant/tenant.module';
import { BranchModule } from '../branch/branch.module';
import { OrderModule } from '../order/order.module';
import { LabReportModule } from '../lab-report/lab-report.module';
import { PdfReportTemplateModule } from '../pdf-report-template/pdf-report-template.module';

/**
 * Public (no-login) patient-order access. Composes the existing tenant, branch,
 * order and lab-report services — it owns no persistence of its own; it only
 * re-validates ownership and reshapes their output into a safe public
 * projection. `ThrottlerModule` is configured in `AppModule`; the controller
 * applies the `ThrottlerGuard` locally so only these routes are rate-limited.
 */
@Module({
  imports: [
    PrismaModule,
    TenantModule,
    BranchModule,
    OrderModule,
    LabReportModule,
    PdfReportTemplateModule,
  ],
  controllers: [PublicController],
  providers: [PublicService],
})
export class PublicModule {}
