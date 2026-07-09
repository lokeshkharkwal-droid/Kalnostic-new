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
import { BranchLabTestService } from './branch-lab-test.service';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { ImportBranchLabTestsDto } from './dto/import-branch-lab-tests.dto';
import { SyncBranchLabTestsDto } from './dto/sync-branch-lab-tests.dto';
import { ListBranchLabTestsQueryDto } from './dto/list-branch-lab-tests-query.dto';
import { UpdateBranchLabTestDto } from './dto/update-branch-lab-test.dto';
import { SetBranchLabTestActiveDto } from './dto/set-branch-lab-test-active.dto';
import { ActiveBranchRequiredException } from './exceptions/branch-lab-test.exceptions';

/**
 * Branch **Lab Test List** endpoints (`/branch-lab-tests`). Business-authenticated;
 * the global `JwtAuthGuard` protects all routes. Tenant comes from the JWT
 * (`@CurrentTenant`) and the active branch from the JWT profile
 * (`@CurrentProfile`) — never from the request body (CLAUDE.md §4.7). Import/sync
 * routes are declared before `:id` so they aren't matched as ids.
 */
@Controller('branch-lab-tests')
export class BranchLabTestController {
  constructor(private readonly branchLabTestService: BranchLabTestService) {}

  /** Resolve the active branch id from the JWT profile, or fail with a 400. */
  private requireBranch(profile: ActiveProfile): string {
    if (!profile.branchId) {
      throw new ActiveBranchRequiredException();
    }
    return profile.branchId;
  }

  /**
   * Persist-import selected Master Data lab tests into the active branch's list.
   */
  @Post('import')
  @Audit({
    module: AuditModule.LAB_TEST,
    action: AuditAction.CREATE,
    description: 'Imported lab tests into branch list',
  })
  import(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Body() dto: ImportBranchLabTestsDto,
  ) {
    return this.branchLabTestService.importFromMasterData(
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
    module: AuditModule.LAB_TEST,
    action: AuditAction.UPDATE,
    description: 'Synced branch lab tests from master data',
  })
  sync(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Body() dto: SyncBranchLabTestsDto,
  ) {
    return this.branchLabTestService.syncFromMasterData(
      tenantId,
      this.requireBranch(profile),
      personId,
      dto,
    );
  }

  /**
   * Duplicate a branch lab test into an independent variant (same group).
   */
  @Post(':id/duplicate')
  @Audit({
    module: AuditModule.LAB_TEST,
    action: AuditAction.CREATE,
    description: 'Duplicated a branch lab test',
  })
  duplicate(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
  ) {
    return this.branchLabTestService.duplicate(
      id,
      tenantId,
      this.requireBranch(profile),
      personId,
    );
  }

  /**
   * Mark a branch lab test as its variant group's default (for order creation).
   */
  @Patch(':id/default')
  @Audit({
    module: AuditModule.LAB_TEST,
    action: AuditAction.UPDATE,
    description: 'Set default branch lab test',
  })
  setDefault(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
  ) {
    return this.branchLabTestService.setDefault(
      id,
      tenantId,
      this.requireBranch(profile),
      personId,
    );
  }

  /**
   * List the active branch's Lab Test List (paginated + search + status).
   */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: ListBranchLabTestsQueryDto,
  ) {
    return this.branchLabTestService.findAll(
      tenantId,
      this.requireBranch(profile),
      query,
    );
  }

  /**
   * Fetch one branch lab test (with its clinical snapshot).
   */
  @Get(':id')
  findOne(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
  ) {
    return this.branchLabTestService.findById(
      id,
      tenantId,
      this.requireBranch(profile),
    );
  }

  /**
   * Edit a branch lab test's branch-tunable fields.
   */
  @Put(':id')
  @Audit({
    module: AuditModule.LAB_TEST,
    action: AuditAction.UPDATE,
    description: 'Updated a branch lab test',
  })
  update(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: UpdateBranchLabTestDto,
  ) {
    return this.branchLabTestService.update(
      id,
      tenantId,
      this.requireBranch(profile),
      personId,
      dto,
    );
  }

  /**
   * Enable/disable a branch lab test.
   */
  @Patch(':id/active')
  @Audit({
    module: AuditModule.LAB_TEST,
    action: AuditAction.UPDATE,
    description: 'Toggled a branch lab test active state',
  })
  setActive(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: SetBranchLabTestActiveDto,
  ) {
    return this.branchLabTestService.setActive(
      id,
      tenantId,
      this.requireBranch(profile),
      personId,
      dto.isActive,
    );
  }

  /**
   * Soft-delete a branch lab test (remove it from the branch's list).
   */
  @Delete(':id')
  @Audit({
    module: AuditModule.LAB_TEST,
    action: AuditAction.DELETE,
    description: 'Removed a branch lab test',
  })
  remove(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
  ) {
    return this.branchLabTestService.remove(
      id,
      tenantId,
      this.requireBranch(profile),
    );
  }
}
