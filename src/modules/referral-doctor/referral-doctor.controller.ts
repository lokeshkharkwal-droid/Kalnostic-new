import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { ReferralDoctorService } from './referral-doctor.service';
import { CreateReferralDoctorDto } from './dto/create-referral-doctor.dto';
import { UpdateReferralDoctorDto } from './dto/update-referral-doctor.dto';
import { ListReferralDoctorsDto } from './dto/list-referral-doctors.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Referral-doctor registry endpoints (business-authenticated; tenant comes from the
 * JWT). The global `JwtAuthGuard` protects all routes.
 */
@Controller('referral-doctors')
export class ReferralDoctorController {
  constructor(private readonly referralDoctorService: ReferralDoctorService) {}

  /**
   * Register a referral doctor in the caller's tenant.
   */
  @Post()
  @Audit({
    module: AuditModule.REFERRAL_DOCTOR,
    action: AuditAction.CREATE,
    description: 'Created a referral doctor',
  })
  create(
    @CurrentTenant() tenantId: string,
    @Body() dto: CreateReferralDoctorDto,
  ) {
    return this.referralDoctorService.create(tenantId, dto);
  }

  /**
   * List referral doctors in the caller's tenant (paginated; trimmed fields).
   * Supports `search` (name / mobile), `departmentId`, `categoryId`, and `status`.
   */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @Query() query: ListReferralDoctorsDto,
  ) {
    return this.referralDoctorService.findAllForTenant(tenantId, query);
  }

  /**
   * Fetch one referral doctor by id (full record incl. children + derived fields).
   */
  @Get(':id')
  findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.referralDoctorService.findById(id, tenantId);
  }

  /**
   * Update a referral doctor.
   */
  @Patch(':id')
  @Audit({
    module: AuditModule.REFERRAL_DOCTOR,
    action: AuditAction.UPDATE,
    description: 'Updated a referral doctor',
  })
  update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateReferralDoctorDto,
  ) {
    return this.referralDoctorService.update(id, tenantId, dto);
  }

  /**
   * Soft-delete a referral doctor.
   */
  @Delete(':id')
  @Audit({
    module: AuditModule.REFERRAL_DOCTOR,
    action: AuditAction.DELETE,
    description: 'Deleted a referral doctor',
  })
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.referralDoctorService.remove(id, tenantId);
  }
}
