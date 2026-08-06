import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { BranchLabPanelListService } from './branch-lab-panel-list.service';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { CreateBranchLabPanelListDto } from './dto/create-branch-lab-panel-list.dto';
import { CloneBranchLabPanelListDto } from './dto/clone-branch-lab-panel-list.dto';
import { RenameBranchLabPanelListDto } from './dto/rename-branch-lab-panel-list.dto';
import { ActiveBranchRequiredException } from '../branch-lab-test/exceptions/branch-lab-test.exceptions';

/**
 * Branch **Lab Panel List** endpoints (`/branch-lab-panel-lists`). Mirror of the
 * Lab Test List controller. Business-authenticated; tenant/branch come from the
 * JWT (CLAUDE.md §4.7). `options` is declared before `:id`.
 */
@Controller('branch-lab-panel-lists')
export class BranchLabPanelListController {
  constructor(private readonly service: BranchLabPanelListService) {}

  /** Resolve the active branch id from the JWT profile, or fail with a 400. */
  private requireBranch(profile: ActiveProfile): string {
    if (!profile.branchId) {
      throw new ActiveBranchRequiredException();
    }
    return profile.branchId;
  }

  /** List all of the branch's Lab Panel Lists (tabs source). */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
  ) {
    return this.service.findAll(tenantId, this.requireBranch(profile));
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
    module: AuditModule.LAB_PANEL,
    action: AuditAction.CREATE,
    description: 'Created a branch lab panel list',
  })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Body() dto: CreateBranchLabPanelListDto,
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
    module: AuditModule.LAB_PANEL,
    action: AuditAction.CREATE,
    description: 'Cloned a branch lab panel list',
  })
  clone(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: CloneBranchLabPanelListDto,
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
    module: AuditModule.LAB_PANEL,
    action: AuditAction.UPDATE,
    description: 'Renamed a branch lab panel list',
  })
  rename(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: RenameBranchLabPanelListDto,
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
    module: AuditModule.LAB_PANEL,
    action: AuditAction.DELETE,
    description: 'Removed a branch lab panel list',
  })
  remove(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
  ) {
    return this.service.remove(id, tenantId, this.requireBranch(profile));
  }
}
