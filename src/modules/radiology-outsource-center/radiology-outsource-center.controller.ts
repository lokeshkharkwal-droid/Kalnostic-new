import {
  UseGuards,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { PermissionGuard } from '../permissions/guards/permission.guard';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { PERMISSION_KEYS } from '../permissions/constants/module-permissions.constant';
import { AuditAction, AuditModule } from '@prisma/client';
import { RadiologyOutsourceCenterService } from './radiology-outsource-center.service';
import { CreateRadiologyOutsourceCenterDto } from './dto/create-radiology-outsource-center.dto';
import { UpdateRadiologyOutsourceCenterDto } from './dto/update-radiology-outsource-center.dto';
import { ListRadiologyOutsourceCentersDto } from './dto/list-radiology-outsource-centers.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Radiology outsource-center endpoints (business-authenticated; tenant comes from
 * the JWT). The global `JwtAuthGuard` protects all routes. Reuses the diagnostics
 * outsource-center permission keys (`BR_OUT_*`) and the
 * `AuditModule.OUTSOURCE_CENTER` audit enum — there are no radiology-specific ones.
 */
@Controller('radiology-outsource-centers')
@UseGuards(PermissionGuard)
export class RadiologyOutsourceCenterController {
  constructor(
    private readonly radiologyOutsourceCenterService: RadiologyOutsourceCenterService,
  ) {}

  /**
   * Create a radiology outsource center (`code` is system-generated).
   */
  @Post()
  @RequirePermission(PERMISSION_KEYS.BR_OUT_ADD)
  @Audit({
    module: AuditModule.OUTSOURCE_CENTER,
    action: AuditAction.CREATE,
    description: 'Created a radiology outsource center',
  })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Body() dto: CreateRadiologyOutsourceCenterDto,
  ) {
    return this.radiologyOutsourceCenterService.create(
      tenantId,
      profile.branchId,
      dto,
    );
  }

  /**
   * List radiology outsource centers in the caller's tenant (paginated). Supports
   * `search` (name / code) and `status` filters.
   */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @Query() query: ListRadiologyOutsourceCentersDto,
  ) {
    return this.radiologyOutsourceCenterService.findAll(tenantId, query);
  }

  /**
   * Fetch one radiology outsource center by id (with the resolved radiology
   * test/panel and list names).
   */
  @Get(':id')
  findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.radiologyOutsourceCenterService.findById(id, tenantId);
  }

  /**
   * Update a radiology outsource center. Used for activate/inactivate too, via
   * `{ isActive }`.
   */
  @Patch(':id')
  @RequirePermission(PERMISSION_KEYS.BR_OUT_UPDATE)
  @Audit({
    module: AuditModule.OUTSOURCE_CENTER,
    action: AuditAction.UPDATE,
    description: 'Updated a radiology outsource center',
  })
  update(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
    @Body() dto: UpdateRadiologyOutsourceCenterDto,
  ) {
    return this.radiologyOutsourceCenterService.update(
      id,
      tenantId,
      profile.branchId,
      dto,
    );
  }

  /**
   * Soft-delete a radiology outsource center.
   */
  @Delete(':id')
  @RequirePermission(PERMISSION_KEYS.BR_OUT_DELETE)
  @Audit({
    module: AuditModule.OUTSOURCE_CENTER,
    action: AuditAction.DELETE,
    description: 'Deleted a radiology outsource center',
  })
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.radiologyOutsourceCenterService.remove(id, tenantId);
  }
}
