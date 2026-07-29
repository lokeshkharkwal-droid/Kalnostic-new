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
import { PatientCategoryService } from './patient-category.service';
import { CreatePatientCategoryDto } from './dto/create-patient-category.dto';
import { UpdatePatientCategoryDto } from './dto/update-patient-category.dto';
import { ListPatientCategoryQueryDto } from './dto/list-patient-category-query.dto';
import { SetActivePatientCategoryDto } from './dto/set-active-patient-category.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { ActiveBranchRequiredException } from './exceptions/patient-category.exceptions';

/**
 * Patient Category endpoints (`/patient-categories`), surfaced in Patient
 * Settings. Business-authenticated; the global `JwtAuthGuard` protects all
 * routes. Tenant comes from the JWT (`@CurrentTenant`) and the active branch
 * from the JWT profile (`@CurrentProfile`) — never the body (CLAUDE.md §4.7) —
 * since a category's Lab Test List / Lab Panel List selections are scoped to
 * the caller's active branch. There is no delete route: categories can only be
 * deactivated, to preserve historical order pricing.
 */
@Controller('patient-categories')
export class PatientCategoryController {
  constructor(
    private readonly patientCategoryService: PatientCategoryService,
  ) {}

  /** Resolve the active branch id from the JWT profile, or fail with a 400. */
  private requireBranch(profile: ActiveProfile): string {
    if (!profile.branchId) {
      throw new ActiveBranchRequiredException();
    }
    return profile.branchId;
  }

  /**
   * Create a patient category in the caller's tenant, mapping its Lab Test
   * List / Lab Panel List to the active branch.
   */
  @Post()
  @Audit({
    module: AuditModule.PATIENT_CATEGORY,
    action: AuditAction.CREATE,
    description: 'Created a patient category',
  })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Body() dto: CreatePatientCategoryDto,
  ) {
    return this.patientCategoryService.create(
      tenantId,
      this.requireBranch(profile),
      dto,
    );
  }

  /**
   * List patient categories in the caller's tenant (paginated, optional
   * `search`/`status` filters), each with the active branch's mapped Lab Test
   * List / Lab Panel List names.
   */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: ListPatientCategoryQueryDto,
  ) {
    return this.patientCategoryService.findAllForTenant(
      tenantId,
      this.requireBranch(profile),
      query.page ?? 1,
      query.limit ?? 10,
      { search: query.search, status: query.status },
    );
  }

  /** Fetch one patient category by id, for the Edit popup. */
  @Get(':id')
  findOne(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
  ) {
    return this.patientCategoryService.findById(
      id,
      tenantId,
      this.requireBranch(profile),
    );
  }

  /**
   * Update a patient category (name, Lab Test/Panel List, status, default).
   */
  @Patch(':id')
  @Audit({
    module: AuditModule.PATIENT_CATEGORY,
    action: AuditAction.UPDATE,
    description: 'Updated a patient category',
  })
  update(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
    @Body() dto: UpdatePatientCategoryDto,
  ) {
    return this.patientCategoryService.update(
      id,
      tenantId,
      this.requireBranch(profile),
      dto,
    );
  }

  /** Activate/inactivate a patient category from the table row switch. */
  @Patch(':id/active')
  @Audit({
    module: AuditModule.PATIENT_CATEGORY,
    action: AuditAction.UPDATE,
    description: 'Toggled a patient category active state',
  })
  setActive(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
    @Body() dto: SetActivePatientCategoryDto,
  ) {
    return this.patientCategoryService.setActive(
      id,
      tenantId,
      this.requireBranch(profile),
      dto.isActive,
    );
  }

  /** Set a patient category as the tenant's default (unsets the previous one). */
  @Patch(':id/default')
  @Audit({
    module: AuditModule.PATIENT_CATEGORY,
    action: AuditAction.UPDATE,
    description: 'Set default patient category',
  })
  setDefault(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
  ) {
    return this.patientCategoryService.setDefault(
      id,
      tenantId,
      this.requireBranch(profile),
    );
  }
}
