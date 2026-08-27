import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PermissionGuard } from '../permissions/guards/permission.guard';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { PERMISSION_KEYS } from '../permissions/constants/module-permissions.constant';
import { AuditAction, AuditModule } from '@prisma/client';
import { InventoryUsageService } from './inventory-usage.service';
import {
  CreateInventoryUsageDto,
  UpdateInventoryUsageDto,
} from './dto/inventory-usage.dto';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Generate Inventory endpoints (LABORATORY.docx §5.9) — manual material-usage
 * rows against a `LabReport`. Nested under `lab-reports/:labReportId` rather
 * than its own top-level controller, mirroring how this action is scoped to
 * one report in the Test Entry screen (unlike the five special worklists,
 * which have their own tenant-wide list views).
 */
@Controller('lab-reports/:labReportId/inventory')
@UseGuards(PermissionGuard)
export class InventoryUsageController {
  constructor(private readonly inventoryUsageService: InventoryUsageService) {}

  @Get()
  @RequirePermission(PERMISSION_KEYS.LAB_VIEW_INVENTORY)
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('labReportId') labReportId: string,
  ) {
    return this.inventoryUsageService.findAll(
      labReportId,
      tenantId,
      profile.branchId,
    );
  }

  @Post()
  @RequirePermission(PERMISSION_KEYS.LAB_UPDATE_INVENTORY)
  @Audit({
    module: AuditModule.INVENTORY_USAGE,
    action: AuditAction.CREATE,
    description: 'Added an inventory usage row',
  })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('labReportId') labReportId: string,
    @Body() dto: CreateInventoryUsageDto,
  ) {
    return this.inventoryUsageService.create(
      labReportId,
      tenantId,
      profile.branchId,
      dto,
    );
  }

  @Patch(':usageId')
  @RequirePermission(PERMISSION_KEYS.LAB_UPDATE_INVENTORY)
  @Audit({
    module: AuditModule.INVENTORY_USAGE,
    action: AuditAction.UPDATE,
    description: 'Updated an inventory usage row',
  })
  update(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('labReportId') labReportId: string,
    @Param('usageId') usageId: string,
    @Body() dto: UpdateInventoryUsageDto,
  ) {
    return this.inventoryUsageService.update(
      labReportId,
      usageId,
      tenantId,
      profile.branchId,
      dto,
    );
  }

  @Delete(':usageId')
  @RequirePermission(PERMISSION_KEYS.LAB_UPDATE_INVENTORY)
  @Audit({
    module: AuditModule.INVENTORY_USAGE,
    action: AuditAction.DELETE,
    description: 'Removed an inventory usage row',
  })
  remove(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('labReportId') labReportId: string,
    @Param('usageId') usageId: string,
  ) {
    return this.inventoryUsageService.remove(
      labReportId,
      usageId,
      tenantId,
      profile.branchId,
    );
  }
}
