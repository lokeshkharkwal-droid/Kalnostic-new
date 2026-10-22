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
import { BranchRadiologyTestService } from './branch-radiology-test.service';
import { BranchService } from '../branch/branch.service';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { ImportBranchRadiologyTestsDto } from './dto/import-branch-radiology-tests.dto';
import { ImportBranchRadiologyTestsByFilterDto } from './dto/import-branch-radiology-tests-by-filter.dto';
import { SyncBranchRadiologyTestsDto } from './dto/sync-branch-radiology-tests.dto';
import { ListBranchRadiologyTestsQueryDto } from './dto/list-branch-radiology-tests-query.dto';
import { ListBranchRadiologyTestsForBranchQueryDto } from './dto/list-branch-radiology-tests-for-branch-query.dto';
import { ListImportableRadiologyTestsQueryDto } from './dto/list-importable-radiology-tests-query.dto';
import { UpdateBranchRadiologyTestDto } from './dto/update-branch-radiology-test.dto';
import { SetBranchRadiologyTestActiveDto } from './dto/set-branch-radiology-test-active.dto';
import { ActiveBranchRequiredException } from '../branch-lab-test/exceptions/branch-lab-test.exceptions';

/**
 * Branch **Radiology Test List** endpoints (`/branch-radiology-tests`).
 * Business-authenticated; the global `JwtAuthGuard` protects all routes. Tenant
 * comes from the JWT (`@CurrentTenant`) and the active branch from the JWT profile
 * (`@CurrentProfile`) — never from the request body (CLAUDE.md §4.7). Import/sync
 * routes are declared before `:id` so they aren't matched as ids. Reuses the
 * `AuditModule.LAB_TEST` audit enum (radiology has no own enum value).
 */
@Controller('branch-radiology-tests')
export class BranchRadiologyTestController {
  constructor(
    private readonly service: BranchRadiologyTestService,
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
   * Persist-import selected Master Data radiology tests into the active branch's
   * list.
   */
  @Post('import')
  @Audit({
    module: AuditModule.LAB_TEST,
    action: AuditAction.CREATE,
    description: 'Imported radiology tests into branch list',
  })
  import(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Body() dto: ImportBranchRadiologyTestsDto,
  ) {
    return this.service.importFromMasterData(
      tenantId,
      this.requireBranch(profile),
      personId,
      dto,
    );
  }

  /**
   * Persist-import every Master Data radiology test matching the given filters
   * into the active branch's list ("select all").
   */
  @Post('import-by-filter')
  @Audit({
    module: AuditModule.LAB_TEST,
    action: AuditAction.CREATE,
    description: 'Imported radiology tests into branch list by filter',
  })
  importByFilter(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Body() dto: ImportBranchRadiologyTestsByFilterDto,
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
    module: AuditModule.LAB_TEST,
    action: AuditAction.UPDATE,
    description: 'Synced branch radiology tests from master data',
  })
  sync(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Body() dto: SyncBranchRadiologyTestsDto,
  ) {
    return this.service.syncFromMasterData(
      tenantId,
      this.requireBranch(profile),
      personId,
      dto,
    );
  }

  /** Duplicate a branch radiology test into an independent variant (same group). */
  @Post(':id/duplicate')
  @Audit({
    module: AuditModule.LAB_TEST,
    action: AuditAction.CREATE,
    description: 'Duplicated a branch radiology test',
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

  /** Mark a branch radiology test as its variant group's default. */
  @Patch(':id/default')
  @Audit({
    module: AuditModule.LAB_TEST,
    action: AuditAction.UPDATE,
    description: 'Set default branch radiology test',
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

  /** List the active branch's Radiology Test List (paginated + search + status). */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: ListBranchRadiologyTestsQueryDto,
  ) {
    return this.service.findAll(tenantId, this.requireBranch(profile), query);
  }

  /**
   * List a specific branch's Radiology Test List rows for a caller with no active
   * branch of their own (Business Admin, viewing a branch they picked).
   * `branchId` is verified to belong to the caller's tenant first. Declared
   * before `:id` so it isn't matched as one.
   */
  @Get('by-branch')
  async findAllForBranch(
    @CurrentTenant() tenantId: string,
    @Query() query: ListBranchRadiologyTestsForBranchQueryDto,
  ) {
    await this.branchService.findById(query.branchId, tenantId);
    const { branchId, ...rest } = query;
    return this.service.findAll(tenantId, branchId, rest);
  }

  /**
   * Import picker source: the active branch's Master Data radiology tests
   * ("Available to Add"), paginated + searchable, with `excludeListId` dropping
   * tests already in that list. Declared before `:id` so it isn't matched as one.
   */
  @Get('importable')
  getImportable(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: ListImportableRadiologyTestsQueryDto,
  ) {
    return this.service.getImportable(
      tenantId,
      this.requireBranch(profile),
      query,
    );
  }

  /** Fetch one branch radiology test. */
  @Get(':id')
  findOne(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
  ) {
    return this.service.findById(id, tenantId, this.requireBranch(profile));
  }

  /** Edit a branch radiology test's branch-tunable fields. */
  @Put(':id')
  @Audit({
    module: AuditModule.LAB_TEST,
    action: AuditAction.UPDATE,
    description: 'Updated a branch radiology test',
  })
  update(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: UpdateBranchRadiologyTestDto,
  ) {
    return this.service.update(
      id,
      tenantId,
      this.requireBranch(profile),
      personId,
      dto,
    );
  }

  /** Enable/disable a branch radiology test. */
  @Patch(':id/active')
  @Audit({
    module: AuditModule.LAB_TEST,
    action: AuditAction.UPDATE,
    description: 'Toggled a branch radiology test active state',
  })
  setActive(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: SetBranchRadiologyTestActiveDto,
  ) {
    return this.service.setActive(
      id,
      tenantId,
      this.requireBranch(profile),
      personId,
      dto.isActive,
    );
  }

  /** Soft-delete a branch radiology test (remove it from the branch's list). */
  @Delete(':id')
  @Audit({
    module: AuditModule.LAB_TEST,
    action: AuditAction.DELETE,
    description: 'Removed a branch radiology test',
  })
  remove(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
  ) {
    return this.service.remove(id, tenantId, this.requireBranch(profile));
  }
}
