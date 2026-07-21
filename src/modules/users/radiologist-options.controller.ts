import { Controller, Get, Query } from '@nestjs/common';
import { UsersService } from './users.service';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { RadiologyTechnicianOptionsQueryDto } from './dto/radiology-technician-options-query.dto';
import { ActiveBranchRequiredException } from '../branch-lab-test/exceptions/branch-lab-test.exceptions';

/**
 * Radiologist **options** endpoint (`GET /radiologists/options`) — a lightweight
 * `{ id, name }` selector for the Create-Order Radiology section. A radiologist
 * is now a staff Person holding the `radiologist` role at the active branch (the
 * old Radiologist master table was deprecated). Business-authenticated; tenant
 * from the JWT (`@CurrentTenant`) and the active branch from the JWT profile
 * (`@CurrentProfile`) — never the body (CLAUDE.md §4.7).
 */
@Controller('radiologists')
export class RadiologistOptionsController {
  constructor(private readonly usersService: UsersService) {}

  /** Resolve the active branch id from the JWT profile, or fail with a 400. */
  private requireBranch(profile: ActiveProfile): string {
    if (!profile.branchId) {
      throw new ActiveBranchRequiredException();
    }
    return profile.branchId;
  }

  /**
   * Lightweight `{ id, name }` options — the active branch's radiologists,
   * optionally filtered by a name `search`.
   */
  @Get('options')
  findOptions(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: RadiologyTechnicianOptionsQueryDto,
  ) {
    return this.usersService.findRadiologistOptions(
      tenantId,
      this.requireBranch(profile),
      { search: query.search, page: query.page, limit: query.limit },
    );
  }
}
