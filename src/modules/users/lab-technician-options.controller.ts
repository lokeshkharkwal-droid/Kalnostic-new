import { Controller, Get, Query } from '@nestjs/common';
import { UsersService } from './users.service';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { RadiologyTechnicianOptionsQueryDto } from './dto/radiology-technician-options-query.dto';
import { ActiveBranchRequiredException } from '../branch-lab-test/exceptions/branch-lab-test.exceptions';

/**
 * Lab technician **options** endpoint (`GET /lab-technicians/options`) — a
 * lightweight `{ id, name }` selector for the Technician Reporting
 * "Schedule/Reschedule Test" Assign To picker (LABORATORY.docx §5.6). A lab
 * technician is a staff Person holding one of the lab-technician roles at the
 * active branch (same pattern as PhlebotomistOptionsController). Business-
 * authenticated; tenant from the JWT (`@CurrentTenant`) and the active branch
 * from the JWT profile (`@CurrentProfile`) — never the body.
 */
@Controller('lab-technicians')
export class LabTechnicianOptionsController {
  constructor(private readonly usersService: UsersService) {}

  /** Resolve the active branch id from the JWT profile, or fail with a 400. */
  private requireBranch(profile: ActiveProfile): string {
    if (!profile.branchId) {
      throw new ActiveBranchRequiredException();
    }
    return profile.branchId;
  }

  /**
   * Lightweight `{ id, name }` options — the active branch's lab technicians,
   * optionally filtered by a name `search`.
   */
  @Get('options')
  findOptions(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: RadiologyTechnicianOptionsQueryDto,
  ) {
    return this.usersService.findLabTechnicianOptions(
      tenantId,
      this.requireBranch(profile),
      { search: query.search, page: query.page, limit: query.limit },
    );
  }
}
