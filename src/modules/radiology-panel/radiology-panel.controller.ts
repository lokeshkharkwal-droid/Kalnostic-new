import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { PermissionGuard } from '../permissions/guards/permission.guard';
import {
  RequireAnyPermission,
  RequirePermission,
} from '../permissions/decorators/require-permission.decorator';
import {
  ADMIN_KEY_GROUPS,
  PERMISSION_KEYS,
} from '../permissions/constants/module-permissions.constant';
import { RadiologyPanelService } from './radiology-panel.service';
import { CreateRadiologyPanelDto } from './dto/create-radiology-panel.dto';
import { UpdateRadiologyPanelDto } from './dto/update-radiology-panel.dto';
import { CloneRadiologyPanelsDto } from './dto/clone-radiology-panels.dto';
import { ListRadiologyPanelsDto } from './dto/list-radiology-panels.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Radiology-panel endpoints, nested under a master data
 * (`/master-data/:masterDataId/radiology-panels`). Business-authenticated; tenant
 * comes from the JWT. The global `JwtAuthGuard` protects all routes. Reuses the
 * master-data lab-panel permission keys (there are no radiology-specific ones)
 * and the `AuditModule.LAB_PANEL` audit enum (radiology has no own enum value).
 */
@Controller('master-data/:masterDataId/radiology-panels')
@UseGuards(PermissionGuard)
export class RadiologyPanelController {
  constructor(private readonly radiologyPanelService: RadiologyPanelService) {}

  /** Create a radiology panel (with nested included tests) in a master data. */
  @Post()
  @RequirePermission(PERMISSION_KEYS.BA_MD_ADD_LAB_PANEL)
  @Audit({
    module: AuditModule.LAB_PANEL,
    action: AuditAction.CREATE,
    description: 'Created a radiology panel',
  })
  create(
    @CurrentTenant() tenantId: string,
    @Param('masterDataId') masterDataId: string,
    @Body() dto: CreateRadiologyPanelDto,
  ) {
    return this.radiologyPanelService.create(masterDataId, tenantId, dto);
  }

  /** List the master data's radiology panels (paginated, core rows only). */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @Param('masterDataId') masterDataId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.radiologyPanelService.findAll(
      masterDataId,
      tenantId,
      query.page ?? 1,
      query.limit ?? 20,
    );
  }

  /**
   * Listing screen for a master data's radiology panels: search (`panelName`/
   * `panelCode`), parent category/department + status filters, paginated by
   * panel. Declared before the `:panelId` routes so `listing` isn't matched as
   * an id.
   */
  @Get('listing')
  listing(
    @CurrentTenant() tenantId: string,
    @Param('masterDataId') masterDataId: string,
    @Query() query: ListRadiologyPanelsDto,
  ) {
    return this.radiologyPanelService.listForListing(
      masterDataId,
      tenantId,
      query,
    );
  }

  /**
   * Clone all radiology panels from this master data into a target master data
   * (duplicate name/code skipped). Returns `{ copied, skipped }`. Declared before
   * the `:panelId` routes so `clone` isn't matched as an id.
   */
  @Post('clone')
  @RequirePermission(PERMISSION_KEYS.BA_MD_DUPLICATE_TEST)
  @Audit({
    module: AuditModule.LAB_PANEL,
    action: AuditAction.CREATE,
    description: 'Cloned radiology panels into another master data',
  })
  clone(
    @CurrentTenant() tenantId: string,
    @Param('masterDataId') masterDataId: string,
    @Body() dto: CloneRadiologyPanelsDto,
  ) {
    return this.radiologyPanelService.cloneAll(
      masterDataId,
      dto.targetMasterDataId,
      tenantId,
    );
  }

  /** Fetch one radiology panel composed with its included tests. */
  @Get(':panelId')
  findOne(
    @CurrentTenant() tenantId: string,
    @Param('masterDataId') masterDataId: string,
    @Param('panelId') panelId: string,
  ) {
    return this.radiologyPanelService.findById(masterDataId, panelId, tenantId);
  }

  /** Update a radiology panel (and replace its included-test set when provided). */
  @Patch(':panelId')
  @RequireAnyPermission(...ADMIN_KEY_GROUPS.PANEL_UPDATE)
  @Audit({
    module: AuditModule.LAB_PANEL,
    action: AuditAction.UPDATE,
    description: 'Updated a radiology panel',
  })
  update(
    @CurrentTenant() tenantId: string,
    @Param('masterDataId') masterDataId: string,
    @Param('panelId') panelId: string,
    @Body() dto: UpdateRadiologyPanelDto,
  ) {
    return this.radiologyPanelService.update(
      masterDataId,
      panelId,
      tenantId,
      dto,
    );
  }

  /** Soft-delete a radiology panel (cascade soft-deletes its included tests). */
  @Delete(':panelId')
  @RequirePermission(PERMISSION_KEYS.BA_MD_DELETE_THE_PANEL)
  @Audit({
    module: AuditModule.LAB_PANEL,
    action: AuditAction.DELETE,
    description: 'Deleted a radiology panel',
  })
  remove(
    @CurrentTenant() tenantId: string,
    @Param('masterDataId') masterDataId: string,
    @Param('panelId') panelId: string,
  ) {
    return this.radiologyPanelService.remove(masterDataId, panelId, tenantId);
  }
}
