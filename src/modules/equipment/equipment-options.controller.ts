import { Controller, Get, Query } from '@nestjs/common';
import { EquipmentService } from './equipment.service';
import { EquipmentOptionsQueryDto } from './dto/equipment-options-query.dto';

/**
 * Equipment **options** endpoint (`GET /equipment/options`) — a lightweight
 * `{ id, name, code }` selector for business screens (the Lab Adapter form's
 * Equipment picker).
 *
 * Unlike the SiteAdmin equipment CRUD controller, this is a **business** route:
 * the global `JwtAuthGuard` protects it (NOT `@Public`/SiteAdmin). Equipment is
 * platform-level and carries no RLS, so a business token can read the global
 * catalogue. Declared before any `:id` route by listing this controller first in
 * the module's `controllers: []`.
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
}
