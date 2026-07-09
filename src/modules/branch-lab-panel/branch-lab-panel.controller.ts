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
import { BranchLabPanelService } from './branch-lab-panel.service';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { ImportBranchLabPanelsDto } from './dto/import-branch-lab-panels.dto';
import { SyncBranchLabPanelsDto } from './dto/sync-branch-lab-panels.dto';
import { ListBranchLabPanelsQueryDto } from './dto/list-branch-lab-panels-query.dto';
import { UpdateBranchLabPanelDto } from './dto/update-branch-lab-panel.dto';
import { SetBranchLabPanelActiveDto } from './dto/set-branch-lab-panel-active.dto';
import { ActiveBranchRequiredException } from '../branch-lab-test/exceptions/branch-lab-test.exceptions';

/**
 * Branch **Lab Panel List** endpoints (`/branch-lab-panels`). Business-
 * authenticated; the global `JwtAuthGuard` protects all routes. Tenant comes from
 * the JWT (`@CurrentTenant`) and the active branch from the JWT profile
 * (`@CurrentProfile`) — never from the body (CLAUDE.md §4.7). Import/sync routes
 * are declared before `:id` so they aren't matched as ids.
 */
@Controller('branch-lab-panels')
export class BranchLabPanelController {
  constructor(private readonly branchLabPanelService: BranchLabPanelService) {}

  /** Resolve the active branch id from the JWT profile, or fail with a 400. */
  private requireBranch(profile: ActiveProfile): string {
    if (!profile.branchId) {
      throw new ActiveBranchRequiredException();
    }
    return profile.branchId;
  }

  /**
   * Persist-import selected Master Data lab panels into the active branch's list.
   */
  @Post('import')
  @Audit({
    module: AuditModule.LAB_PANEL,
    action: AuditAction.CREATE,
    description: 'Imported lab panels into branch list',
  })
  import(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Body() dto: ImportBranchLabPanelsDto,
  ) {
    return this.branchLabPanelService.importFromMasterData(
      tenantId,
      this.requireBranch(profile),
      personId,
      dto,
    );
  }

  /**
   * Re-snapshot the branch list from Master Data (all copies, or a subset).
   */
  @Post('sync')
  @Audit({
    module: AuditModule.LAB_PANEL,
    action: AuditAction.UPDATE,
    description: 'Synced branch lab panels from master data',
  })
  sync(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Body() dto: SyncBranchLabPanelsDto,
  ) {
    return this.branchLabPanelService.syncFromMasterData(
      tenantId,
      this.requireBranch(profile),
      personId,
      dto,
    );
  }

  /**
   * Duplicate a branch lab panel into an independent variant (same group).
   */
  @Post(':id/duplicate')
  @Audit({
    module: AuditModule.LAB_PANEL,
    action: AuditAction.CREATE,
    description: 'Duplicated a branch lab panel',
  })
  duplicate(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
  ) {
    return this.branchLabPanelService.duplicate(
      id,
      tenantId,
      this.requireBranch(profile),
      personId,
    );
  }

  /**
   * Mark a branch lab panel as its variant group's default (for order creation).
   */
  @Patch(':id/default')
  @Audit({
    module: AuditModule.LAB_PANEL,
    action: AuditAction.UPDATE,
    description: 'Set default branch lab panel',
  })
  setDefault(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
  ) {
    return this.branchLabPanelService.setDefault(
      id,
      tenantId,
      this.requireBranch(profile),
      personId,
    );
  }

  /**
   * List the active branch's Lab Panel List (paginated + search + status).
   */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: ListBranchLabPanelsQueryDto,
  ) {
    return this.branchLabPanelService.findAll(
      tenantId,
      this.requireBranch(profile),
      query,
    );
  }

  /**
   * Fetch one branch lab panel composed with its member tests.
   */
  @Get(':id')
  findOne(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
  ) {
    return this.branchLabPanelService.findById(
      id,
      tenantId,
      this.requireBranch(profile),
    );
  }

  /**
   * Edit a branch lab panel's branch-tunable fields.
   */
  @Put(':id')
  @Audit({
    module: AuditModule.LAB_PANEL,
    action: AuditAction.UPDATE,
    description: 'Updated a branch lab panel',
  })
  update(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: UpdateBranchLabPanelDto,
  ) {
    return this.branchLabPanelService.update(
      id,
      tenantId,
      this.requireBranch(profile),
      personId,
      dto,
    );
  }

  /**
   * Enable/disable a branch lab panel.
   */
  @Patch(':id/active')
  @Audit({
    module: AuditModule.LAB_PANEL,
    action: AuditAction.UPDATE,
    description: 'Toggled a branch lab panel active state',
  })
  setActive(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: SetBranchLabPanelActiveDto,
  ) {
    return this.branchLabPanelService.setActive(
      id,
      tenantId,
      this.requireBranch(profile),
      personId,
      dto.isActive,
    );
  }

  /**
   * Soft-delete a branch lab panel (remove it from the branch's list).
   */
  @Delete(':id')
  @Audit({
    module: AuditModule.LAB_PANEL,
    action: AuditAction.DELETE,
    description: 'Removed a branch lab panel',
  })
  remove(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
  ) {
    return this.branchLabPanelService.remove(
      id,
      tenantId,
      this.requireBranch(profile),
    );
  }
}
