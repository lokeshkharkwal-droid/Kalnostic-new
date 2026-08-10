import { Controller, Get, Query } from '@nestjs/common';
import { PtCategoryService } from './pt-category.service';
import { PtCategoryOptionsQueryDto } from './dto/pt-category-options-query.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { ActiveBranchRequiredException } from './exceptions/pt-category.exceptions';

/**
 * PT Category dropdown feed (`/pt-categories/options`). Registered before
 * `PtCategoryController` so the static `options` route matches ahead of `:id`.
 * Business-authenticated; tenant/branch come from the JWT (CLAUDE.md §4.7).
 * Returns only ACTIVE categories in the caller's active branch.
 */
@Controller('pt-categories')
export class PtCategoryOptionsController {
  constructor(private readonly ptCategoryService: PtCategoryService) {}

  /** Resolve the active branch id from the JWT profile, or fail with a 400. */
  private requireBranch(profile: ActiveProfile): string {
    if (!profile.branchId) {
      throw new ActiveBranchRequiredException();
    }
    return profile.branchId;
  }

  /** Paginated `{ id, name }` options for the active branch (optional `search`). */
  @Get('options')
  findOptions(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: PtCategoryOptionsQueryDto,
  ) {
    return this.ptCategoryService.findOptions(
      tenantId,
      this.requireBranch(profile),
      { page: query.page, limit: query.limit, search: query.search },
    );
  }

  /**
   * The branch's active default PT category (`{ id, categoryName }` or null) —
   * pre-selected on the Create-Order page. Registered here so the static
   * `default` route matches before `:id` on the main controller.
   */
  @Get('default')
  findDefault(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
  ) {
    return this.ptCategoryService.findDefaultForBranch(
      tenantId,
      this.requireBranch(profile),
    );
  }
}
