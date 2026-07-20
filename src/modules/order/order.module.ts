import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AppointmentModule } from '../appointment/appointment.module';
import { PhlebotomistScheduleModule } from '../phlebotomist-schedule/phlebotomist-schedule.module';
import { OrderController } from './order.controller';
import { OrderService } from './order.service';

/**
 * Order Management feature module. Tenant-scoped + branch-level. All foreign
 * references (patient / department / doctor / branch-catalogue / referral /
 * person) are validated against Prisma directly. The radiologist, phlebotomist,
 * and radiology technician are now staff `Person`s (validated as active persons).
 * Imports `AppointmentModule` so an order saved as APPOINTMENT can create its
 * linked appointment lifecycle record via `AppointmentService` (rule #3 DI).
 */
@Module({
  imports: [PrismaModule, AppointmentModule, PhlebotomistScheduleModule],
  controllers: [OrderController],
  providers: [OrderService],
  exports: [OrderService],
})
export class OrderModule {}
