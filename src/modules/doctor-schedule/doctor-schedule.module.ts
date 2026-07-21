import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { DoctorsModule } from '../doctors/doctors.module';
import { BranchModule } from '../branch/branch.module';
import { DoctorScheduleController } from './doctor-schedule.controller';
import { DoctorListController } from './doctor-list.controller';
import { DoctorScheduleOptionsController } from './doctor-schedule-options.controller';
import { DoctorScheduleService } from './doctor-schedule.service';
import { DoctorSlotService } from './doctor-slot.service';
import { DoctorListService } from './doctor-list.service';

/**
 * Doctor Schedule feature module. Imports DoctorsModule and BranchModule to
 * validate the doctor/branch via their exported services (CLAUDE.md rule #3 —
 * services are injected, never imported directly). `DoctorSlotService` is
 * exported so the order/appointment flow can reserve slots (`reserveInTx`) later.
 *
 * Controllers are ordered options → list → schedule so the static `options` and
 * `doctors` sub-paths register before the schedule controller's `:id` route.
 */
@Module({
  imports: [PrismaModule, DoctorsModule, BranchModule],
  controllers: [
    DoctorScheduleOptionsController,
    DoctorListController,
    DoctorScheduleController,
  ],
  providers: [DoctorScheduleService, DoctorSlotService, DoctorListService],
  exports: [DoctorScheduleService, DoctorSlotService],
})
export class DoctorScheduleModule {}
