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
import { ReferralPanelService } from './referral-panel.service';
import { CreateReferralPanelDto } from './dto/create-referral-panel.dto';
import { UpdateReferralPanelDto } from './dto/update-referral-panel.dto';
import { ListReferralPanelsDto } from './dto/list-referral-panels.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Referral-panel endpoints (business-authenticated; tenant comes from the JWT).
 * The global `JwtAuthGuard` protects all routes.
 */
@Controller('referral-panels')
export class ReferralPanelController {
  constructor(private readonly referralPanelService: ReferralPanelService) {}

  /**
   * Create a referral panel with its assigned lab tests/panels.
   */
  @Post()
  @Audit({
    module: AuditModule.REFERRAL_PANEL,
    action: AuditAction.CREATE,
    description: 'Created a referral panel',
  })
  create(
    @CurrentTenant() tenantId: string,
    @Body() dto: CreateReferralPanelDto,
  ) {
    return this.referralPanelService.create(tenantId, dto);
  }

  /**
   * List referral panels in the caller's tenant (paginated; optional `search`).
   */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @Query() query: ListReferralPanelsDto,
  ) {
    return this.referralPanelService.findAll(tenantId, query);
  }

  /**
   * Fetch one referral panel by id (with assigned lab tests/panels).
   */
  @Get(':id')
  findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.referralPanelService.findById(id, tenantId);
  }

  /**
   * Update a referral panel (assigned lab tests/panels are replace-all when sent).
   */
  @Patch(':id')
  @Audit({
    module: AuditModule.REFERRAL_PANEL,
    action: AuditAction.UPDATE,
    description: 'Updated a referral panel',
  })
  update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateReferralPanelDto,
  ) {
    return this.referralPanelService.update(id, tenantId, dto);
  }

  /**
   * Soft-delete a referral panel (cascades to assigned lab tests/panels).
   */
  @Delete(':id')
  @Audit({
    module: AuditModule.REFERRAL_PANEL,
    action: AuditAction.DELETE,
    description: 'Deleted a referral panel',
  })
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.referralPanelService.remove(id, tenantId);
  }
}
