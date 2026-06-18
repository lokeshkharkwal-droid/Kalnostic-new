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
import { ExternalReferralService } from './external-referral.service';
import { CreateExternalReferralDto } from './dto/create-external-referral.dto';
import { UpdateExternalReferralDto } from './dto/update-external-referral.dto';
import { ListExternalReferralsDto } from './dto/list-external-referrals.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * External-referral registry endpoints (business-authenticated; tenant comes from the
 * JWT). The global `JwtAuthGuard` protects all routes.
 */
@Controller('external-referrals')
export class ExternalReferralController {
  constructor(
    private readonly externalReferralService: ExternalReferralService,
  ) {}

  /**
   * Register an external referral in the caller's tenant.
   */
  @Post()
  @Audit({
    module: AuditModule.EXTERNAL_REFERRAL,
    action: AuditAction.CREATE,
    description: 'Created an external referral',
  })
  create(
    @CurrentTenant() tenantId: string,
    @Body() dto: CreateExternalReferralDto,
  ) {
    return this.externalReferralService.create(tenantId, dto);
  }

  /**
   * List external referrals in the caller's tenant (paginated; trimmed fields).
   * Supports `search` (name / organisation / mobile / referral code) and `status`.
   */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @Query() query: ListExternalReferralsDto,
  ) {
    return this.externalReferralService.findAllForTenant(tenantId, query);
  }

  /**
   * Fetch one external referral by id (full record incl. assigned lab tests/panels).
   */
  @Get(':id')
  findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.externalReferralService.findById(id, tenantId);
  }

  /**
   * Update an external referral.
   */
  @Patch(':id')
  @Audit({
    module: AuditModule.EXTERNAL_REFERRAL,
    action: AuditAction.UPDATE,
    description: 'Updated an external referral',
  })
  update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateExternalReferralDto,
  ) {
    return this.externalReferralService.update(id, tenantId, dto);
  }

  /**
   * Soft-delete an external referral.
   */
  @Delete(':id')
  @Audit({
    module: AuditModule.EXTERNAL_REFERRAL,
    action: AuditAction.DELETE,
    description: 'Deleted an external referral',
  })
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.externalReferralService.remove(id, tenantId);
  }
}
