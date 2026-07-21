import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AppointmentModule } from '../appointment/appointment.module';
import { PhlebotomistScheduleModule } from '../phlebotomist-schedule/phlebotomist-schedule.module';
import { LabReportModule } from '../lab-report/lab-report.module';
import { OrderController } from './order.controller';
import { OrderService } from './order.service';

/**
 * Order Management feature module. Tenant-scoped + branch-level. All foreign
 * references (patient / department / doctor / branch-catalogue / referral /
 * person) are validated against Prisma directly. The radiologist, phlebotomist,
 * and radiology technician are now staff `Person`s (validated as active persons).
 * Imports `AppointmentModule` so an order saved as APPOINTMENT can create its
 * linked appointment lifecycle record via `AppointmentService` (rule #3 DI).
 * Imports `LabReportModule` so `collectItem` can trigger
 * `LabReportService.ensureCreatedForAcceptedItem` — the interim signal for
 * Technician Reporting until Accession's own sample-accept step exists (see
 * LabReportService doc comment).
 */
@Module({
  imports: [
    PrismaModule,
    AppointmentModule,
    PhlebotomistScheduleModule,
    LabReportModule,
  ],
  controllers: [OrderController],
  providers: [OrderService],
  exports: [OrderService],
})
export class OrderModule {}
