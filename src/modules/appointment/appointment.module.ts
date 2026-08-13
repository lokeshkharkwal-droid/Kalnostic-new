import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PhlebotomistScheduleModule } from '../phlebotomist-schedule/phlebotomist-schedule.module';
import { RegistrationSettingsModule } from '../registration-settings/registration-settings.module';
import { AppointmentController } from './appointment.controller';
import { AppointmentService } from './appointment.service';

/**
 * Appointment status-tracking module. Tenant-scoped + branch-level. Exposes the
 * service so other modules can create/transition appointments via DI (rule #3).
 * Imports `PhlebotomistScheduleModule` so cancelling/reactivating an appointment
 * releases/re-reserves the linked home-visit slot (via `SlotReservationService`),
 * and `RegistrationSettingsModule` for `ExternalIdService` (auto-generated APT id).
 */
@Module({
  imports: [
    PrismaModule,
    PhlebotomistScheduleModule,
    RegistrationSettingsModule,
  ],
  controllers: [AppointmentController],
  providers: [AppointmentService],
  exports: [AppointmentService],
})
export class AppointmentModule {}
