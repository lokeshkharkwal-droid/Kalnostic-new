import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PdfReportTemplateModule } from '../pdf-report-template/pdf-report-template.module';
import { AppointmentModule } from '../appointment/appointment.module';
import { AccessionModule } from '../accession/accession.module';
import { PhlebotomistScheduleModule } from '../phlebotomist-schedule/phlebotomist-schedule.module';
import { PhlebotomistCollectionModule } from '../phlebotomist-collection/phlebotomist-collection.module';
import { RegistrationSettingsModule } from '../registration-settings/registration-settings.module';
import { CommunicationModule } from '../communication/communication.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { TenantModule } from '../tenant/tenant.module';
import { OrderController } from './order.controller';
import { OrderService } from './order.service';

/**
 * Order Management feature module. Tenant-scoped + branch-level. All foreign
 * references (patient / department / doctor / branch-catalogue / referral /
 * person) are validated against Prisma directly. The radiologist, phlebotomist,
 * and radiology technician are now staff `Person`s (validated as active persons).
 * Imports `AppointmentModule` so an order saved as APPOINTMENT can create its
 * linked appointment lifecycle record via `AppointmentService`, and
 * `AccessionModule` so a confirmed order generates its accession samples via
 * `OrderSampleService` (rule #3 DI). Technician Reporting's `LabReport`
 * creation is no longer triggered from here — `AccessionModule` now owns that
 * trigger (a sample reaching `ACCEPTED`), so `OrderModule` no longer needs
 * `LabReportModule`.
 */
@Module({
  imports: [
    PrismaModule,
    PdfReportTemplateModule,
    AppointmentModule,
    PhlebotomistScheduleModule,
    PhlebotomistCollectionModule,
    AccessionModule,
    RegistrationSettingsModule,
    CommunicationModule,
    PermissionsModule,
    TenantModule,
  ],
  controllers: [OrderController],
  providers: [OrderService],
  exports: [OrderService],
})
export class OrderModule {}
