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
import { InternalReferralService } from './internal-referral.service';
import { CreateInternalReferralDto } from './dto/create-internal-referral.dto';
import { UpdateInternalReferralDto } from './dto/update-internal-referral.dto';
import { ListInternalReferralsDto } from './dto/list-internal-referrals.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Internal-referral registry endpoints (business-authenticated; tenant comes from the
 * JWT). The global `JwtAuthGuard` protects all routes.
 */
@Controller('internal-referrals')
@UseGuards(PermissionGuard)
export class InternalReferralController {
  constructor(
    private readonly internalReferralService: InternalReferralService,
  ) {}

  /**
   * Register an internal referral in the caller's tenant.
   */
  @Post()
  @RequirePermission(PERMISSION_KEYS.BR_REF_ADD_INTERNAL)
  @Audit({
    module: AuditModule.INTERNAL_REFERRAL,
    action: AuditAction.CREATE,
    description: 'Created an internal referral',
  })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Body() dto: CreateInternalReferralDto,
  ) {
    return this.internalReferralService.create(
      tenantId,
      profile.branchId,
      personId,
      dto,
    );
  }

  /**
   * List internal referrals in the caller's tenant (paginated; trimmed fields).
   * Supports `search` (employee name / mobile), `status`, and `branchId`.
   */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @Query() query: ListInternalReferralsDto,
  ) {
    return this.internalReferralService.findAllForTenant(tenantId, query);
  }

  /**
   * Fetch one internal referral by id (full record incl. assigned lab tests/panels).
   */
  @Get(':id')
  findOne(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
  ) {
    return this.internalReferralService.findById(
      id,
      tenantId,
      profile.branchId,
    );
  }

  /**
   * Update an internal referral.
   */
  @Patch(':id')
  @RequirePermission(PERMISSION_KEYS.BR_REF_UPDATE_INTERNAL)
  @Audit({
    module: AuditModule.INTERNAL_REFERRAL,
    action: AuditAction.UPDATE,
    description: 'Updated an internal referral',
  })
  update(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: UpdateInternalReferralDto,
  ) {
    return this.internalReferralService.update(
      id,
      tenantId,
      profile.branchId,
      personId,
      dto,
    );
  }

  /**
   * Soft-delete an internal referral.
   */
  @Delete(':id')
  @RequirePermission(PERMISSION_KEYS.BR_REF_DELETE_INTERNAL)
  @Audit({
    module: AuditModule.INTERNAL_REFERRAL,
    action: AuditAction.DELETE,
    description: 'Deleted an internal referral',
  })
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.internalReferralService.remove(id, tenantId);
  }
}
