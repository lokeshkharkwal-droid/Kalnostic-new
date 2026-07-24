import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AppointmentModule } from '../appointment/appointment.module';
import { AccessionModule } from '../accession/accession.module';
import { PhlebotomistScheduleModule } from '../phlebotomist-schedule/phlebotomist-schedule.module';
import { PhlebotomistCollectionModule } from '../phlebotomist-collection/phlebotomist-collection.module';
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
 * `AccessionSampleService` (rule #3 DI).
 */
@Module({
  imports: [
    PrismaModule,
    AppointmentModule,
    AccessionModule,
    PhlebotomistScheduleModule,
    PhlebotomistCollectionModule,
  ],
  controllers: [OrderController],
  providers: [OrderService],
  exports: [OrderService],
})
export class OrderModule {}
