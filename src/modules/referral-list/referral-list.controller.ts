import { Controller, Get, Query } from '@nestjs/common';
import { ReferralListAssignmentService } from './referral-list-assignment.service';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { ResolveListsQueryDto } from './dto/resolve-lists-query.dto';
import { ActiveBranchRequiredException } from '../branch-lab-test/exceptions/branch-lab-test.exceptions';

/**
 * Referral-list resolution endpoint (`/referral-lists`). Business-authenticated;
 * tenant/branch come from the JWT (CLAUDE.md §4.7). The Create-Order form calls
 * `resolve` when a referral changes to load the correct pricing lists.
 */
@Controller('referral-lists')
export class ReferralListController {
  constructor(private readonly service: ReferralListAssignmentService) {}

  /** Resolve the pricing lists for the given referrals (priority + default). */
  @Get('resolve')
  resolve(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: ResolveListsQueryDto,
  ) {
    if (!profile.branchId) {
      throw new ActiveBranchRequiredException();
    }
    return this.service.resolve(tenantId, profile.branchId, query);
  }
}
