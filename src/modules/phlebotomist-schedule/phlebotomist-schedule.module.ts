import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { UsersModule } from '../users/users.module';
import { BranchModule } from '../branch/branch.module';
import { PhlebotomistScheduleController } from './phlebotomist-schedule.controller';
import { PhlebotomistListController } from './phlebotomist-list.controller';
import { PhlebotomistScheduleOptionsController } from './phlebotomist-schedule-options.controller';
import { ServiceZoneController } from './service-zone.controller';
import { PhlebotomistScheduleService } from './phlebotomist-schedule.service';
import { PhlebotomistSlotService } from './phlebotomist-slot.service';
import { PhlebotomistListService } from './phlebotomist-list.service';
import { PhlebotomistDirectoryService } from './phlebotomist-directory.service';
import { SlotReservationService } from './slot-reservation.service';
import { ServiceZoneService } from './service-zone.service';

/**
 * Phlebotomist Schedule feature module. Imports UsersModule (resolve the
 * phlebotomist option picker) and BranchModule (branch validation/name) via their
 * exported services (CLAUDE.md rule #3 — services are injected, never imported
 * directly). A phlebotomist is a staff Person holding the `phlebotomist` role at a
 * branch — there is no phlebotomist master table.
 *
 * Controllers are ordered options → zones → list → schedule so the static
 * `options`, `service-zones`, and `phlebotomists` sub-paths register before the
 * schedule controller's `:id` route.
 */
@Module({
  imports: [PrismaModule, UsersModule, BranchModule],
  controllers: [
    PhlebotomistScheduleOptionsController,
    ServiceZoneController,
    PhlebotomistListController,
    PhlebotomistScheduleController,
  ],
  providers: [
    PhlebotomistScheduleService,
    PhlebotomistSlotService,
    PhlebotomistListService,
    PhlebotomistDirectoryService,
    SlotReservationService,
    ServiceZoneService,
  ],
  exports: [
    PhlebotomistScheduleService,
    PhlebotomistDirectoryService,
    SlotReservationService,
  ],
})
export class PhlebotomistScheduleModule {}
