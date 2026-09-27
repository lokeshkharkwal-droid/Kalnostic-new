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
import { BranchOpdPanelService } from './branch-opd-panel.service';
import { BranchService } from '../branch/branch.service';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { ImportBranchOpdPanelsDto } from './dto/import-branch-opd-panels.dto';
import { ImportBranchOpdPanelsByFilterDto } from './dto/import-branch-opd-panels-by-filter.dto';
import { SyncBranchOpdPanelsDto } from './dto/sync-branch-opd-panels.dto';
import { ListBranchOpdPanelsQueryDto } from './dto/list-branch-opd-panels-query.dto';
import { ListBranchOpdPanelsForBranchQueryDto } from './dto/list-branch-opd-panels-for-branch-query.dto';
import { UpdateBranchOpdPanelDto } from './dto/update-branch-opd-panel.dto';
import { BulkEditBranchOpdPanelsDto } from './dto/bulk-edit-branch-opd-panels.dto';
import { SetBranchOpdPanelActiveDto } from './dto/set-branch-opd-panel-active.dto';
import { ActiveBranchRequiredException } from '../branch-opd-test/exceptions/branch-opd-test.exceptions';

/**
 * Branch **Opd Panel List** endpoints (`/branch-opd-panels`).
 * Business-authenticated; the global `JwtAuthGuard` protects all routes. Tenant
 * from `@CurrentTenant`, active branch from `@CurrentProfile` — never from the body
 * (CLAUDE.md §4.7). Import/sync routes are declared before `:id`.
 */
@Controller('branch-opd-panels')
export class BranchOpdPanelController {
  constructor(
    private readonly branchOpdPanelService: BranchOpdPanelService,
    private readonly branchService: BranchService,
  ) {}

  /** Resolve the active branch id from the JWT profile, or fail with a 400. */
  private requireBranch(profile: ActiveProfile): string {
    if (!profile.branchId) {
      throw new ActiveBranchRequiredException();
    }
    return profile.branchId;
  }

  /** Persist-import selected Master Data opd panels into the active branch's list. */
  @Post('import')
  @Audit({
    module: AuditModule.OPD,
    action: AuditAction.CREATE,
    description: 'Imported opd panels into branch list',
  })
  import(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Body() dto: ImportBranchOpdPanelsDto,
  ) {
    return this.branchOpdPanelService.importFromMasterData(
      tenantId,
      this.requireBranch(profile),
      personId,
      dto,
    );
  }

  /** Persist-import every Master Data opd panel matching the given filters. */
  @Post('import-by-filter')
  @Audit({
    module: AuditModule.OPD,
    action: AuditAction.CREATE,
    description: 'Imported opd panels into branch list by filter',
  })
  importByFilter(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Body() dto: ImportBranchOpdPanelsByFilterDto,
  ) {
    return this.branchOpdPanelService.importFromMasterDataByFilter(
      tenantId,
      this.requireBranch(profile),
      personId,
      dto,
    );
  }

  /** Re-snapshot the branch list from Master Data (all copies, or a subset). */
  @Post('sync')
  @Audit({
    module: AuditModule.OPD,
    action: AuditAction.UPDATE,
    description: 'Synced branch opd panels from master data',
  })
  sync(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Body() dto: SyncBranchOpdPanelsDto,
  ) {
    return this.branchOpdPanelService.syncFromMasterData(
      tenantId,
      this.requireBranch(profile),
      personId,
      dto,
    );
  }

  /** Bulk-edit branch opd panels. Declared before the `:id` routes. */
  @Patch('bulk')
  @Audit({
    module: AuditModule.OPD,
    action: AuditAction.UPDATE,
    description: 'Bulk-edited branch opd panels',
  })
  bulkUpdate(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Body() dto: BulkEditBranchOpdPanelsDto,
  ) {
    return this.branchOpdPanelService.bulkUpdate(
      tenantId,
      this.requireBranch(profile),
      personId,
      dto,
    );
  }

  /** Duplicate a branch opd panel into an independent variant (same group). */
  @Post(':id/duplicate')
  @Audit({
    module: AuditModule.OPD,
    action: AuditAction.CREATE,
    description: 'Duplicated a branch opd panel',
  })
  duplicate(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
  ) {
    return this.branchOpdPanelService.duplicate(
      id,
      tenantId,
      this.requireBranch(profile),
      personId,
    );
  }

  /** Mark a branch opd panel as its variant group's default. */
  @Patch(':id/default')
  @Audit({
    module: AuditModule.OPD,
    action: AuditAction.UPDATE,
    description: 'Set default branch opd panel',
  })
  setDefault(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
  ) {
    return this.branchOpdPanelService.setDefault(
      id,
      tenantId,
      this.requireBranch(profile),
      personId,
    );
  }

  /** List the active branch's Opd Panel List (paginated + search + status). */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: ListBranchOpdPanelsQueryDto,
  ) {
    return this.branchOpdPanelService.findAll(
      tenantId,
      this.requireBranch(profile),
      query,
    );
  }

  /**
   * List a specific branch's Opd Panel List rows for a caller with no active
   * branch of their own (Business Admin). `branchId` is verified first. Declared
   * before `:id`.
   */
  @Get('by-branch')
  async findAllForBranch(
    @CurrentTenant() tenantId: string,
    @Query() query: ListBranchOpdPanelsForBranchQueryDto,
  ) {
    await this.branchService.findById(query.branchId, tenantId);
    const { branchId, ...rest } = query;
    return this.branchOpdPanelService.findAll(tenantId, branchId, rest);
  }

  /** Fetch one branch opd panel composed with its member tests. */
  @Get(':id')
  findOne(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
  ) {
    return this.branchOpdPanelService.findById(
      id,
      tenantId,
      this.requireBranch(profile),
    );
  }

  /** Edit a branch opd panel's branch-tunable fields. */
  @Put(':id')
  @Audit({
    module: AuditModule.OPD,
    action: AuditAction.UPDATE,
    description: 'Updated a branch opd panel',
  })
  update(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: UpdateBranchOpdPanelDto,
  ) {
    return this.branchOpdPanelService.update(
      id,
      tenantId,
      this.requireBranch(profile),
      personId,
      dto,
    );
  }

  /** Enable/disable a branch opd panel. */
  @Patch(':id/active')
  @Audit({
    module: AuditModule.OPD,
    action: AuditAction.UPDATE,
    description: 'Toggled a branch opd panel active state',
  })
  setActive(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: SetBranchOpdPanelActiveDto,
  ) {
    return this.branchOpdPanelService.setActive(
      id,
      tenantId,
      this.requireBranch(profile),
      personId,
      dto.isActive,
    );
  }

  /** Soft-delete a branch opd panel (remove it from the branch's list). */
  @Delete(':id')
  @Audit({
    module: AuditModule.OPD,
    action: AuditAction.DELETE,
    description: 'Removed a branch opd panel',
  })
  remove(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
  ) {
    return this.branchOpdPanelService.remove(
      id,
      tenantId,
      this.requireBranch(profile),
    );
  }
}
