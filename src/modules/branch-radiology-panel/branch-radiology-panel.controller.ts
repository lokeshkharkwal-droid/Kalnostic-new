import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { BranchRadiologyPanelService } from './branch-radiology-panel.service';
import { BranchService } from '../branch/branch.service';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { ImportBranchRadiologyPanelsDto } from './dto/import-branch-radiology-panels.dto';
import { ImportBranchRadiologyPanelsByFilterDto } from './dto/import-branch-radiology-panels-by-filter.dto';
import { SyncBranchRadiologyPanelsDto } from './dto/sync-branch-radiology-panels.dto';
import { ListBranchRadiologyPanelsQueryDto } from './dto/list-branch-radiology-panels-query.dto';
import { ListBranchRadiologyPanelsForBranchQueryDto } from './dto/list-branch-radiology-panels-for-branch-query.dto';
import { ListImportableRadiologyPanelsQueryDto } from './dto/list-importable-radiology-panels-query.dto';
import { UpdateBranchRadiologyPanelDto } from './dto/update-branch-radiology-panel.dto';
import { SetBranchRadiologyPanelActiveDto } from './dto/set-branch-radiology-panel-active.dto';
import { ActiveBranchRequiredException } from '../branch-lab-test/exceptions/branch-lab-test.exceptions';

/**
 * Branch **Radiology Panel List** endpoints (`/branch-radiology-panels`).
 * Business-authenticated; the global `JwtAuthGuard` protects all routes. Tenant
 * comes from the JWT (`@CurrentTenant`) and the active branch from the JWT profile
 * (`@CurrentProfile`) — never from the body (CLAUDE.md §4.7). Import/sync routes
 * are declared before `:id` so they aren't matched as ids. Reuses the
 * `AuditModule.LAB_PANEL` audit enum (radiology has no own enum value). Bulk-edit
 * is intentionally dropped.
 */
@Controller('branch-radiology-panels')
export class BranchRadiologyPanelController {
  constructor(
    private readonly service: BranchRadiologyPanelService,
    private readonly branchService: BranchService,
  ) {}

  /** Resolve the active branch id from the JWT profile, or fail with a 400. */
  private requireBranch(profile: ActiveProfile): string {
    if (!profile.branchId) {
      throw new ActiveBranchRequiredException();
    }
    return profile.branchId;
  }

  /**
   * Persist-import selected Master Data radiology panels into the active branch's
   * list.
   */
  @Post('import')
  @Audit({
    module: AuditModule.LAB_PANEL,
    action: AuditAction.CREATE,
    description: 'Imported radiology panels into branch list',
  })
  import(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Body() dto: ImportBranchRadiologyPanelsDto,
  ) {
    return this.service.importFromMasterData(
      tenantId,
      this.requireBranch(profile),
      personId,
      dto,
    );
  }

  /**
   * Persist-import every Master Data radiology panel matching the given filters
   * into the active branch's list ("select all").
   */
  @Post('import-by-filter')
  @Audit({
    module: AuditModule.LAB_PANEL,
    action: AuditAction.CREATE,
    description: 'Imported radiology panels into branch list by filter',
  })
  importByFilter(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Body() dto: ImportBranchRadiologyPanelsByFilterDto,
  ) {
    return this.service.importFromMasterDataByFilter(
      tenantId,
      this.requireBranch(profile),
      personId,
      dto,
    );
  }

  /** Re-snapshot the branch list from Master Data (all copies, or a subset). */
  @Post('sync')
  @Audit({
    module: AuditModule.LAB_PANEL,
    action: AuditAction.UPDATE,
    description: 'Synced branch radiology panels from master data',
  })
  sync(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Body() dto: SyncBranchRadiologyPanelsDto,
  ) {
    return this.service.syncFromMasterData(
      tenantId,
      this.requireBranch(profile),
      personId,
      dto,
    );
  }

  /** Duplicate a branch radiology panel into an independent variant (same group). */
  @Post(':id/duplicate')
  @Audit({
    module: AuditModule.LAB_PANEL,
    action: AuditAction.CREATE,
    description: 'Duplicated a branch radiology panel',
  })
  duplicate(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
  ) {
    return this.service.duplicate(
      id,
      tenantId,
      this.requireBranch(profile),
      personId,
    );
  }

  /** Mark a branch radiology panel as its variant group's default (for order creation). */
  @Patch(':id/default')
  @Audit({
    module: AuditModule.LAB_PANEL,
    action: AuditAction.UPDATE,
    description: 'Set default branch radiology panel',
  })
  setDefault(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
  ) {
    return this.service.setDefault(
      id,
      tenantId,
      this.requireBranch(profile),
      personId,
    );
  }

  /** List the active branch's Radiology Panel List (paginated + search + status). */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: ListBranchRadiologyPanelsQueryDto,
  ) {
    return this.service.findAll(tenantId, this.requireBranch(profile), query);
  }

  /**
   * List a specific branch's Radiology Panel List rows for a caller with no active
   * branch of their own (Business Admin, viewing a branch they picked).
   * `branchId` is verified to belong to the caller's tenant first. Declared
   * before `:id` so it isn't matched as one.
   */
  @Get('by-branch')
  async findAllForBranch(
    @CurrentTenant() tenantId: string,
    @Query() query: ListBranchRadiologyPanelsForBranchQueryDto,
  ) {
    await this.branchService.findById(query.branchId, tenantId);
    const { branchId, ...rest } = query;
    return this.service.findAll(tenantId, branchId, rest);
  }

  /**
   * Import picker source: the active branch's Master Data radiology panels
   * ("Available to Add"), paginated + searchable, with `excludeListId` dropping
   * panels already in that list. Declared before `:id` so it isn't matched as one.
   */
  @Get('importable')
  getImportable(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: ListImportableRadiologyPanelsQueryDto,
  ) {
    return this.service.getImportable(
      tenantId,
      this.requireBranch(profile),
      query,
    );
  }

  /** Fetch one branch radiology panel composed with its member tests. */
  @Get(':id')
  findOne(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
  ) {
    return this.service.findById(id, tenantId, this.requireBranch(profile));
  }

  /** Edit a branch radiology panel's branch-tunable fields. */
  @Put(':id')
  @Audit({
    module: AuditModule.LAB_PANEL,
    action: AuditAction.UPDATE,
    description: 'Updated a branch radiology panel',
  })
  update(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: UpdateBranchRadiologyPanelDto,
  ) {
    return this.service.update(
      id,
      tenantId,
      this.requireBranch(profile),
      personId,
      dto,
    );
  }

  /** Enable/disable a branch radiology panel. */
  @Patch(':id/active')
  @Audit({
    module: AuditModule.LAB_PANEL,
    action: AuditAction.UPDATE,
    description: 'Toggled a branch radiology panel active state',
  })
  setActive(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: SetBranchRadiologyPanelActiveDto,
  ) {
    return this.service.setActive(
      id,
      tenantId,
      this.requireBranch(profile),
      personId,
      dto.isActive,
    );
  }

  /** Soft-delete a branch radiology panel (remove it from the branch's list). */
  @Delete(':id')
  @Audit({
    module: AuditModule.LAB_PANEL,
    action: AuditAction.DELETE,
    description: 'Removed a branch radiology panel',
  })
  remove(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
  ) {
    return this.service.remove(id, tenantId, this.requireBranch(profile));
  }
}
