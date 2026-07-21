import { Controller, Get, Query } from '@nestjs/common';
import { UsersService } from './users.service';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { BranchUserOptionsQueryDto } from './dto/branch-user-options-query.dto';
import { ActiveBranchRequiredException } from '../branch-lab-test/exceptions/branch-lab-test.exceptions';

/**
 * Branch **users** options endpoint (`GET /users/branch-users/options`) — a
 * lightweight `{ id, name }` selector listing every active user at the active
 * branch, regardless of role. Used by the Create-Order Radiology section's
 * Technician picker, which must offer all branch staff (not only radiology
 * technicians). Business-authenticated; tenant from the JWT (`@CurrentTenant`)
 * and the active branch from the JWT profile (`@CurrentProfile`) — never the body
 * (CLAUDE.md §4.7).
 */
@Controller('users/branch-users')
export class BranchUserOptionsController {
  constructor(private readonly usersService: UsersService) {}

  /** Resolve the active branch id from the JWT profile, or fail with a 400. */
  private requireBranch(profile: ActiveProfile): string {
    if (!profile.branchId) {
      throw new ActiveBranchRequiredException();
    }
    return profile.branchId;
  }

  /**
   * Lightweight `{ id, name }` options for the searchable selector — every active
   * user at the active branch, optionally filtered by a name `search`.
   */
  @Get('options')
  findOptions(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: BranchUserOptionsQueryDto,
  ) {
    return this.usersService.findActiveBranchUserOptions(
      tenantId,
      this.requireBranch(profile),
      { search: query.search, page: query.page, limit: query.limit },
    );
  }
}
