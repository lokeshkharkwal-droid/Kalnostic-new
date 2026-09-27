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
import { BranchOpdTestService } from './branch-opd-test.service';
import { BranchService } from '../branch/branch.service';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { ImportBranchOpdTestsDto } from './dto/import-branch-opd-tests.dto';
import { ImportBranchOpdTestsByFilterDto } from './dto/import-branch-opd-tests-by-filter.dto';
import { SyncBranchOpdTestsDto } from './dto/sync-branch-opd-tests.dto';
import { ListBranchOpdTestsQueryDto } from './dto/list-branch-opd-tests-query.dto';
import { ListBranchOpdTestsForBranchQueryDto } from './dto/list-branch-opd-tests-for-branch-query.dto';
import { UpdateBranchOpdTestDto } from './dto/update-branch-opd-test.dto';
import { BulkEditBranchOpdTestsDto } from './dto/bulk-edit-branch-opd-tests.dto';
import { SetBranchOpdTestActiveDto } from './dto/set-branch-opd-test-active.dto';
import { ActiveBranchRequiredException } from './exceptions/branch-opd-test.exceptions';

/**
 * Branch **Opd Test List** endpoints (`/branch-opd-tests`).
 * Business-authenticated; the global `JwtAuthGuard` protects all routes. Tenant
 * from `@CurrentTenant`, active branch from `@CurrentProfile` — never the body
 * (CLAUDE.md §4.7). Import/sync routes are declared before `:id`.
 */
@Controller('branch-opd-tests')
export class BranchOpdTestController {
  constructor(
    private readonly branchOpdTestService: BranchOpdTestService,
    private readonly branchService: BranchService,
  ) {}

  /** Resolve the active branch id from the JWT profile, or fail with a 400. */
  private requireBranch(profile: ActiveProfile): string {
    if (!profile.branchId) {
      throw new ActiveBranchRequiredException();
    }
    return profile.branchId;
  }

  /** Persist-import selected Master Data opd tests into the active branch's list. */
  @Post('import')
  @Audit({
    module: AuditModule.OPD,
    action: AuditAction.CREATE,
    description: 'Imported opd tests into branch list',
  })
  import(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Body() dto: ImportBranchOpdTestsDto,
  ) {
    return this.branchOpdTestService.importFromMasterData(
      tenantId,
      this.requireBranch(profile),
      personId,
      dto,
    );
  }

  /** Persist-import every Master Data opd test matching the given filters. */
  @Post('import-by-filter')
  @Audit({
    module: AuditModule.OPD,
    action: AuditAction.CREATE,
    description: 'Imported opd tests into branch list by filter',
  })
  importByFilter(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Body() dto: ImportBranchOpdTestsByFilterDto,
  ) {
    return this.branchOpdTestService.importFromMasterDataByFilter(
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
    description: 'Synced branch opd tests from master data',
  })
  sync(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Body() dto: SyncBranchOpdTestsDto,
  ) {
    return this.branchOpdTestService.syncFromMasterData(
      tenantId,
      this.requireBranch(profile),
      personId,
      dto,
    );
  }

  /** Bulk-edit branch opd tests. Declared before the `:id` routes. */
  @Patch('bulk')
  @Audit({
    module: AuditModule.OPD,
    action: AuditAction.UPDATE,
    description: 'Bulk-edited branch opd tests',
  })
  bulkUpdate(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Body() dto: BulkEditBranchOpdTestsDto,
  ) {
    return this.branchOpdTestService.bulkUpdate(
      tenantId,
      this.requireBranch(profile),
      personId,
      dto,
    );
  }

  /** Duplicate a branch opd test into an independent variant (same group). */
  @Post(':id/duplicate')
  @Audit({
    module: AuditModule.OPD,
    action: AuditAction.CREATE,
    description: 'Duplicated a branch opd test',
  })
  duplicate(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
  ) {
    return this.branchOpdTestService.duplicate(
      id,
      tenantId,
      this.requireBranch(profile),
      personId,
    );
  }

  /** Mark a branch opd test as its variant group's default. */
  @Patch(':id/default')
  @Audit({
    module: AuditModule.OPD,
    action: AuditAction.UPDATE,
    description: 'Set default branch opd test',
  })
  setDefault(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
  ) {
    return this.branchOpdTestService.setDefault(
      id,
      tenantId,
      this.requireBranch(profile),
      personId,
    );
  }

  /** List the active branch's Opd Test List (paginated + search + status). */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: ListBranchOpdTestsQueryDto,
  ) {
    return this.branchOpdTestService.findAll(
      tenantId,
      this.requireBranch(profile),
      query,
    );
  }

  /**
   * List a specific branch's Opd Test List rows for a caller with no active
   * branch of their own (Business Admin). `branchId` is verified first. Declared
   * before `:id`.
   */
  @Get('by-branch')
  async findAllForBranch(
    @CurrentTenant() tenantId: string,
    @Query() query: ListBranchOpdTestsForBranchQueryDto,
  ) {
    await this.branchService.findById(query.branchId, tenantId);
    const { branchId, ...rest } = query;
    return this.branchOpdTestService.findAll(tenantId, branchId, rest);
  }

  /** Fetch one branch opd test (with its clinical snapshot). */
  @Get(':id')
  findOne(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
  ) {
    return this.branchOpdTestService.findById(
      id,
      tenantId,
      this.requireBranch(profile),
    );
  }

  /** Edit a branch opd test's branch-tunable fields. */
  @Put(':id')
  @Audit({
    module: AuditModule.OPD,
    action: AuditAction.UPDATE,
    description: 'Updated a branch opd test',
  })
  update(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: UpdateBranchOpdTestDto,
  ) {
    return this.branchOpdTestService.update(
      id,
      tenantId,
      this.requireBranch(profile),
      personId,
      dto,
    );
  }

  /** Enable/disable a branch opd test. */
  @Patch(':id/active')
  @Audit({
    module: AuditModule.OPD,
    action: AuditAction.UPDATE,
    description: 'Toggled a branch opd test active state',
  })
  setActive(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: SetBranchOpdTestActiveDto,
  ) {
    return this.branchOpdTestService.setActive(
      id,
      tenantId,
      this.requireBranch(profile),
      personId,
      dto.isActive,
    );
  }

  /** Soft-delete a branch opd test (remove it from the branch's list). */
  @Delete(':id')
  @Audit({
    module: AuditModule.OPD,
    action: AuditAction.DELETE,
    description: 'Removed a branch opd test',
  })
  remove(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
  ) {
    return this.branchOpdTestService.remove(
      id,
      tenantId,
      this.requireBranch(profile),
    );
  }
}
