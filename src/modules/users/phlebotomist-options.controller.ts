import { Controller, Get, Query } from '@nestjs/common';
import { UsersService } from './users.service';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { RadiologyTechnicianOptionsQueryDto } from './dto/radiology-technician-options-query.dto';
import { ActiveBranchRequiredException } from '../branch-lab-test/exceptions/branch-lab-test.exceptions';

/**
 * Phlebotomist **options** endpoint (`GET /phlebotomists/options`) — a
 * lightweight `{ id, name }` selector for the Create-Order Diagnostics section.
 * A phlebotomist is now a staff Person holding the `phlebotomist` role at the
 * active branch (the old Phlebotomist master table was deprecated).
 * Business-authenticated; tenant from the JWT (`@CurrentTenant`) and the active
 * branch from the JWT profile (`@CurrentProfile`) — never the body.
 */
@Controller('phlebotomists')
export class PhlebotomistOptionsController {
  constructor(private readonly usersService: UsersService) {}

  /** Resolve the active branch id from the JWT profile, or fail with a 400. */
  private requireBranch(profile: ActiveProfile): string {
    if (!profile.branchId) {
      throw new ActiveBranchRequiredException();
    }
    return profile.branchId;
  }

  /**
   * Lightweight `{ id, name }` options — the active branch's phlebotomists,
   * optionally filtered by a name `search`.
   */
  @Get('options')
  findOptions(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: RadiologyTechnicianOptionsQueryDto,
  ) {
    return this.usersService.findPhlebotomistOptions(
      tenantId,
      this.requireBranch(profile),
      { search: query.search, page: query.page, limit: query.limit },
    );
  }
}
