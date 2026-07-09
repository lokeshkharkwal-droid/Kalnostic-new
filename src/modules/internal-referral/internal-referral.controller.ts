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
import { InternalReferralService } from './internal-referral.service';
import { CreateInternalReferralDto } from './dto/create-internal-referral.dto';
import { UpdateInternalReferralDto } from './dto/update-internal-referral.dto';
import { ListInternalReferralsDto } from './dto/list-internal-referrals.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Internal-referral registry endpoints (business-authenticated; tenant comes from the
 * JWT). The global `JwtAuthGuard` protects all routes.
 */
@Controller('internal-referrals')
export class InternalReferralController {
  constructor(
    private readonly internalReferralService: InternalReferralService,
  ) {}

  /**
   * Register an internal referral in the caller's tenant.
   */
  @Post()
  @Audit({
    module: AuditModule.INTERNAL_REFERRAL,
    action: AuditAction.CREATE,
    description: 'Created an internal referral',
  })
  create(
    @CurrentTenant() tenantId: string,
    @Body() dto: CreateInternalReferralDto,
  ) {
    return this.internalReferralService.create(tenantId, dto);
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
  findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.internalReferralService.findById(id, tenantId);
  }

  /**
   * Update an internal referral.
   */
  @Patch(':id')
  @Audit({
    module: AuditModule.INTERNAL_REFERRAL,
    action: AuditAction.UPDATE,
    description: 'Updated an internal referral',
  })
  update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateInternalReferralDto,
  ) {
    return this.internalReferralService.update(id, tenantId, dto);
  }

  /**
   * Soft-delete an internal referral.
   */
  @Delete(':id')
  @Audit({
    module: AuditModule.INTERNAL_REFERRAL,
    action: AuditAction.DELETE,
    description: 'Deleted an internal referral',
  })
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.internalReferralService.remove(id, tenantId);
  }
}
