import { Controller, Get, Query } from '@nestjs/common';
import { UsersService } from './users.service';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { RadiologyTechnicianOptionsQueryDto } from './dto/radiology-technician-options-query.dto';
import { ActiveBranchRequiredException } from '../branch-lab-test/exceptions/branch-lab-test.exceptions';

/**
 * Radiology Technician **options** endpoint (`GET /radiology-technicians/options`)
 * — a lightweight `{ id, name }` selector for the Create-Order Radiology section.
 * A technician is a Person holding an active radiology technician profile at the
 * active branch (resolved in `UsersService`). Business-authenticated; tenant from
 * the JWT (`@CurrentTenant`) and the active branch from the JWT profile
 * (`@CurrentProfile`) — never the body (CLAUDE.md §4.7).
 */
@Controller('radiology-technicians')
export class RadiologyTechnicianOptionsController {
  constructor(private readonly usersService: UsersService) {}

  /** Resolve the active branch id from the JWT profile, or fail with a 400. */
  private requireBranch(profile: ActiveProfile): string {
    if (!profile.branchId) {
      throw new ActiveBranchRequiredException();
    }
    return profile.branchId;
  }

  /**
   * Lightweight `{ id, name }` options for the searchable selector — the active
   * branch's radiology technician staff, optionally filtered by a name `search`.
   */
  @Get('options')
  findOptions(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: RadiologyTechnicianOptionsQueryDto,
  ) {
    return this.usersService.findRadiologyTechnicianOptions(
      tenantId,
      this.requireBranch(profile),
      { search: query.search, page: query.page, limit: query.limit },
    );
  }
}
