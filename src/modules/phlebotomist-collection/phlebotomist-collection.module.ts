import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AccessionModule } from '../accession/accession.module';
import { PhlebotomistScheduleModule } from '../phlebotomist-schedule/phlebotomist-schedule.module';
import { PhlebotomistCollectionController } from './phlebotomist-collection.controller';
import { PhlebotomistCollectionService } from './phlebotomist-collection.service';

/**
 * Phlebotomist / home sample-collection feature module. Tenant-scoped +
 * branch-level. Owns the `HomeVisitCollection` lifecycle behind the Collection
 * Schedule, dashboard and reports.
 *
 * Imports (rule #3 — services injected, never imported directly):
 * - `AccessionModule` → `AccessionSampleService` to collect/accept the order's
 *   samples through the accession state machine when a collection advances.
 * - `PhlebotomistScheduleModule` → `SlotReservationService` to release/reserve the
 *   phlebotomist slot on reschedule/cancel.
 *
 * Exports its service so `OrderModule` can create a collection row when a confirmed
 * home-visit order is placed.
 */
@Module({
  imports: [PrismaModule, AccessionModule, PhlebotomistScheduleModule],
  controllers: [PhlebotomistCollectionController],
  providers: [PhlebotomistCollectionService],
  exports: [PhlebotomistCollectionService],
})
export class PhlebotomistCollectionModule {}
