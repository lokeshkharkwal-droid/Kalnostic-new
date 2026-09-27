import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { BranchRadiologyPanelListService } from './branch-radiology-panel-list.service';
import { BranchService } from '../branch/branch.service';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { CreateBranchRadiologyPanelListDto } from './dto/create-branch-radiology-panel-list.dto';
import { CloneBranchRadiologyPanelListDto } from './dto/clone-branch-radiology-panel-list.dto';
import { RenameBranchRadiologyPanelListDto } from './dto/rename-branch-radiology-panel-list.dto';
import { ByBranchQueryDto } from './dto/by-branch-query.dto';
import { ActiveBranchRequiredException } from '../branch-radiology-test/exceptions/branch-radiology-test.exceptions';

/**
 * Branch **Radiology Panel List** endpoints (`/branch-radiology-panel-lists`).
 * Business-authenticated (global `JwtAuthGuard`). Tenant from `@CurrentTenant`,
 * active branch from `@CurrentProfile` — never the body (CLAUDE.md §4.7). `options`
 * is declared before `:id` so it isn't matched as an id.
 */
@Controller('branch-radiology-panel-lists')
export class BranchRadiologyPanelListController {
  constructor(
    private readonly service: BranchRadiologyPanelListService,
    private readonly branchService: BranchService,
  ) {}

  /** Resolve the active branch id from the JWT profile, or fail with a 400. */
  private requireBranch(profile: ActiveProfile): string {
    if (!profile.branchId) {
      throw new ActiveBranchRequiredException();
    }
    return profile.branchId;
  }

  /** List all of the branch's Radiology Panel Lists (tabs source). */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
  ) {
    return this.service.findAll(tenantId, this.requireBranch(profile));
  }

  /**
   * List a specific branch's Radiology Panel Lists for a caller with no active
   * branch of their own (Business Admin). `branchId` is verified first.
   */
  @Get('by-branch')
  async findAllForBranch(
    @CurrentTenant() tenantId: string,
    @Query() query: ByBranchQueryDto,
  ) {
    await this.branchService.findById(query.branchId, tenantId);
    return this.service.findAll(tenantId, query.branchId);
  }

  /** `{ id, name, isDefault }[]` options for the list selectors. */
  @Get('options')
  findOptions(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
  ) {
    return this.service.findOptions(tenantId, this.requireBranch(profile));
  }

  /** Create a new list (seeded from the default list with computed prices). */
  @Post()
  @Audit({
    module: AuditModule.RADIOLOGY,
    action: AuditAction.CREATE,
    description: 'Created a branch radiology panel list',
  })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Body() dto: CreateBranchRadiologyPanelListDto,
  ) {
    return this.service.create(
      tenantId,
      this.requireBranch(profile),
      personId,
      dto,
    );
  }

  /** Clone an existing list into a new independent list. */
  @Post(':id/clone')
  @Audit({
    module: AuditModule.RADIOLOGY,
    action: AuditAction.CREATE,
    description: 'Cloned a branch radiology panel list',
  })
  clone(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: CloneBranchRadiologyPanelListDto,
  ) {
    return this.service.clone(
      id,
      tenantId,
      this.requireBranch(profile),
      personId,
      dto,
    );
  }

  /** Rename a list. */
  @Patch(':id')
  @Audit({
    module: AuditModule.RADIOLOGY,
    action: AuditAction.UPDATE,
    description: 'Renamed a branch radiology panel list',
  })
  rename(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: RenameBranchRadiologyPanelListDto,
  ) {
    return this.service.rename(
      id,
      tenantId,
      this.requireBranch(profile),
      personId,
      dto,
    );
  }

  /** Soft-delete a list (blocked for the default Walk-in list). */
  @Delete(':id')
  @Audit({
    module: AuditModule.RADIOLOGY,
    action: AuditAction.DELETE,
    description: 'Removed a branch radiology panel list',
  })
  remove(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
  ) {
    return this.service.remove(id, tenantId, this.requireBranch(profile));
  }
}
