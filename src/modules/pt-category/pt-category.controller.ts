import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { PtCategoryService } from './pt-category.service';
import { CreatePtCategoryDto } from './dto/create-pt-category.dto';
import { UpdatePtCategoryDto } from './dto/update-pt-category.dto';
import { ListPtCategoryQueryDto } from './dto/list-pt-category-query.dto';
import { SetActivePtCategoryDto } from './dto/set-active-pt-category.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { ActiveBranchRequiredException } from './exceptions/pt-category.exceptions';

/**
 * PT (Patient) Category endpoints (`/pt-categories`), surfaced on the
 * Registration Settings page. Business-authenticated; the global `JwtAuthGuard`
 * protects all routes. Tenant comes from the JWT (`@CurrentTenant`) and the
 * active branch from the JWT profile (`@CurrentProfile`) — never the body
 * (CLAUDE.md §4.7), since a PT category belongs to the caller's active branch.
 * There is no delete route: categories are only deactivated, to preserve
 * historical order pricing.
 */
@Controller('pt-categories')
export class PtCategoryController {
  constructor(private readonly ptCategoryService: PtCategoryService) {}

  /** Resolve the active branch id from the JWT profile, or fail with a 400. */
  private requireBranch(profile: ActiveProfile): string {
    if (!profile.branchId) {
      throw new ActiveBranchRequiredException();
    }
    return profile.branchId;
  }

  /** Create a PT category on the caller's active branch. */
  @Post()
  @Audit({
    module: AuditModule.PT_CATEGORY,
    action: AuditAction.CREATE,
    description: 'Created a PT category',
  })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Body() dto: CreatePtCategoryDto,
  ) {
    return this.ptCategoryService.create(
      tenantId,
      this.requireBranch(profile),
      personId ?? null,
      dto,
    );
  }

  /**
   * List PT categories in the caller's active branch (paginated, optional
   * `search`/`status` filters), each with its mapped Lab Test / Lab Panel.
   */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: ListPtCategoryQueryDto,
  ) {
    return this.ptCategoryService.findAllForBranch(
      tenantId,
      this.requireBranch(profile),
      query.page ?? 1,
      query.limit ?? 10,
      { search: query.search, status: query.status },
    );
  }

  /** Fetch one PT category by id, for the View/Edit popup. */
  @Get(':id')
  findOne(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
  ) {
    return this.ptCategoryService.findById(
      id,
      tenantId,
      this.requireBranch(profile),
    );
  }

  /** Update a PT category (name, mapped Lab Test/Panel, default, status). */
  @Patch(':id')
  @Audit({
    module: AuditModule.PT_CATEGORY,
    action: AuditAction.UPDATE,
    description: 'Updated a PT category',
  })
  update(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePtCategoryDto,
  ) {
    return this.ptCategoryService.update(
      id,
      tenantId,
      this.requireBranch(profile),
      personId ?? null,
      dto,
    );
  }

  /** Activate/inactivate a PT category from the settings table row switch. */
  @Patch(':id/active')
  @Audit({
    module: AuditModule.PT_CATEGORY,
    action: AuditAction.UPDATE,
    description: 'Toggled a PT category active state',
  })
  setActive(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
    @Body() dto: SetActivePtCategoryDto,
  ) {
    return this.ptCategoryService.setActive(
      id,
      tenantId,
      this.requireBranch(profile),
      dto.isActive,
    );
  }
}
