import { Controller, Get, Param, Query } from '@nestjs/common';
import { EquipmentService } from './equipment.service';
import { EquipmentOptionsQueryDto } from './dto/equipment-options-query.dto';

/**
 * Equipment **options** endpoint (`GET /equipment/options`) — a lightweight
 * `{ id, name, code }` selector for business screens (the Lab Adapter form's
 * Equipment picker) — plus `GET /equipment/:id/lab-tests`, the equipment's
 * SITE_ADMIN-mapped lab tests (so the Lab Adapter form can display and auto-map
 * from them).
 *
 * Unlike the SiteAdmin equipment CRUD controller, these are **business** routes:
 * the global `JwtAuthGuard` protects them (NOT `@Public`/SiteAdmin). Equipment is
 * platform-level and carries no RLS, so a business token can read the global
 * catalogue. Declared before the SiteAdmin CRUD controller by listing this
 * controller first in the module's `controllers: []`.
 */
@Controller('equipment')
export class EquipmentOptionsController {
  constructor(private readonly equipmentService: EquipmentService) {}

  /**
   * Lightweight `{ id, name, code }` options for the searchable Equipment
   * selector — active global equipment, optionally filtered by `search`.
   */
  @Get('options')
  findOptions(@Query() query: EquipmentOptionsQueryDto) {
    return this.equipmentService.findOptions({
      search: query.search,
      page: query.page,
      limit: query.limit,
    });
  }

  /**
   * The `{ id, testName, testCode }[]` lab tests mapped to this equipment in Site
   * Admin (`EquipmentLabTest`). Read-only; used by the Lab Adapter form to show an
   * equipment's tests and drive per-branch auto-mapping on create.
   */
  @Get(':id/lab-tests')
  findLabTests(@Param('id') id: string) {
    return this.equipmentService.findLabTests(id);
  }
}
