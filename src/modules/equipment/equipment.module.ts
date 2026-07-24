import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SiteAdminEquipmentController } from './siteadmin-equipment.controller';
import { EquipmentOptionsController } from './equipment-options.controller';
import { EquipmentService } from './equipment.service';

/**
 * Equipment feature module. Platform-level (SiteAdmin-owned) global lab-equipment
 * catalogue entries, each mapping many-to-many to SITE_ADMIN lab-test templates
 * via `EquipmentLabTest`. Lab-test references are validated against the `LabTest`
 * model directly through `PrismaService`, so no other feature module needs to be
 * imported. Exposes a SiteAdmin CRUD controller plus a business-authenticated
 * `GET /equipment/options` selector (listed first so its static route matches
 * before any `:id`).
 */
@Module({
  imports: [PrismaModule],
  controllers: [EquipmentOptionsController, SiteAdminEquipmentController],
  providers: [EquipmentService],
  exports: [EquipmentService],
})
export class EquipmentModule {}
