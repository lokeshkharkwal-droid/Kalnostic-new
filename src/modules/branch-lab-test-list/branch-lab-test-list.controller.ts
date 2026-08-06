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
import { BranchLabTestListService } from './branch-lab-test-list.service';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { CreateBranchLabTestListDto } from './dto/create-branch-lab-test-list.dto';
import { CloneBranchLabTestListDto } from './dto/clone-branch-lab-test-list.dto';
import { RenameBranchLabTestListDto } from './dto/rename-branch-lab-test-list.dto';
import { ActiveBranchRequiredException } from '../branch-lab-test/exceptions/branch-lab-test.exceptions';

/**
 * Branch **Lab Test List** endpoints (`/branch-lab-test-lists`). Business-authenticated
 * (global `JwtAuthGuard`). Tenant from `@CurrentTenant`, active branch from
 * `@CurrentProfile` — never the body (CLAUDE.md §4.7). `options` is declared before
 * `:id` so it isn't matched as an id.
 */
@Controller('branch-lab-test-lists')
export class BranchLabTestListController {
  constructor(private readonly service: BranchLabTestListService) {}

  /** Resolve the active branch id from the JWT profile, or fail with a 400. */
  private requireBranch(profile: ActiveProfile): string {
    if (!profile.branchId) {
      throw new ActiveBranchRequiredException();
    }
    return profile.branchId;
  }

  /** List all of the branch's Lab Test Lists (tabs source). */
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
    module: AuditModule.LAB_TEST,
    action: AuditAction.CREATE,
    description: 'Created a branch lab test list',
  })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Body() dto: CreateBranchLabTestListDto,
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
    module: AuditModule.LAB_TEST,
    action: AuditAction.CREATE,
    description: 'Cloned a branch lab test list',
  })
  clone(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: CloneBranchLabTestListDto,
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
    module: AuditModule.LAB_TEST,
    action: AuditAction.UPDATE,
    description: 'Renamed a branch lab test list',
  })
  rename(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: RenameBranchLabTestListDto,
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
    module: AuditModule.LAB_TEST,
    action: AuditAction.DELETE,
    description: 'Removed a branch lab test list',
  })
  remove(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
  ) {
    return this.service.remove(id, tenantId, this.requireBranch(profile));
  }
}
