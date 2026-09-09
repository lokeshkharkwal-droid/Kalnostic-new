import {
  UseGuards,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { PermissionGuard } from '../permissions/guards/permission.guard';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { PERMISSION_KEYS } from '../permissions/constants/module-permissions.constant';
import { AuditAction, AuditModule } from '@prisma/client';
import { ReferralDoctorService } from './referral-doctor.service';
import { CreateReferralDoctorDto } from './dto/create-referral-doctor.dto';
import { UpdateReferralDoctorDto } from './dto/update-referral-doctor.dto';
import { ListReferralDoctorsDto } from './dto/list-referral-doctors.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Referral-doctor registry endpoints (business-authenticated; tenant comes from the
 * JWT). The global `JwtAuthGuard` protects all routes.
 */
@Controller('referral-doctors')
@UseGuards(PermissionGuard)
export class ReferralDoctorController {
  constructor(private readonly referralDoctorService: ReferralDoctorService) {}

  /**
   * Register a referral doctor in the caller's tenant.
   */
  @Post()
  @RequirePermission(PERMISSION_KEYS.BR_REF_ADD_DOCTOR)
  @Audit({
    module: AuditModule.REFERRAL_DOCTOR,
    action: AuditAction.CREATE,
    description: 'Created a referral doctor',
  })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Body() dto: CreateReferralDoctorDto,
  ) {
    return this.referralDoctorService.create(
      tenantId,
      profile.branchId,
      personId,
      dto,
    );
  }

  /**
   * List referral doctors in the caller's tenant (paginated; trimmed fields).
   * Supports `search` (name / mobile), `departmentId`, `categoryId`, `status`,
   * and `branchId`.
   */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: ListReferralDoctorsDto,
  ) {
    return this.referralDoctorService.findAllForTenant(
      tenantId,
      profile.branchId,
      query,
    );
  }

  /**
   * Fetch one referral doctor by id (full record incl. children + derived fields).
   */
  @Get(':id')
  findOne(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
  ) {
    return this.referralDoctorService.findById(id, tenantId, profile.branchId);
  }

  /**
   * Update a referral doctor.
   */
  @Patch(':id')
  @RequirePermission(PERMISSION_KEYS.BR_REF_UPDATE_DOCTOR)
  @Audit({
    module: AuditModule.REFERRAL_DOCTOR,
    action: AuditAction.UPDATE,
    description: 'Updated a referral doctor',
  })
  update(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: UpdateReferralDoctorDto,
  ) {
    return this.referralDoctorService.update(
      id,
      tenantId,
      profile.branchId,
      personId,
      dto,
    );
  }

  /**
   * Soft-delete a referral doctor.
   */
  @Delete(':id')
  @RequirePermission(PERMISSION_KEYS.BR_REF_DELETE_DOCTOR)
  @Audit({
    module: AuditModule.REFERRAL_DOCTOR,
    action: AuditAction.DELETE,
    description: 'Deleted a referral doctor',
  })
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.referralDoctorService.remove(id, tenantId);
  }
}
