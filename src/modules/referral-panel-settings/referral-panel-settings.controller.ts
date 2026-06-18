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
import { ReferralPanelSettingsService } from './referral-panel-settings.service';
import { CreateReferralPanelSettingsDto } from './dto/create-referral-panel-settings.dto';
import { UpdateReferralPanelSettingsDto } from './dto/update-referral-panel-settings.dto';
import { ListReferralPanelSettingsDto } from './dto/list-referral-panel-settings.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Referral-panel-settings endpoints (business-authenticated; tenant comes from the
 * JWT). The global `JwtAuthGuard` protects all routes. A settings template is a
 * reusable billing/communication profile referenced by referral entities.
 */
@Controller('referral-panel-settings')
export class ReferralPanelSettingsController {
  constructor(
    private readonly referralPanelSettingsService: ReferralPanelSettingsService,
  ) {}

  /**
   * Create a referral panel settings template.
   */
  @Post()
  @Audit({
    module: AuditModule.REFERRAL_PANEL_SETTINGS,
    action: AuditAction.CREATE,
    description: 'Created a referral panel settings template',
  })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Body() dto: CreateReferralPanelSettingsDto,
  ) {
    return this.referralPanelSettingsService.create(tenantId, dto, personId);
  }

  /**
   * List settings templates in the caller's tenant (paginated; optional filters).
   */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @Query() query: ListReferralPanelSettingsDto,
  ) {
    return this.referralPanelSettingsService.findAll(tenantId, query);
  }

  /**
   * Fetch one settings template by id.
   */
  @Get(':id')
  findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.referralPanelSettingsService.findById(id, tenantId);
  }

  /**
   * Update a settings template.
   */
  @Patch(':id')
  @Audit({
    module: AuditModule.REFERRAL_PANEL_SETTINGS,
    action: AuditAction.UPDATE,
    description: 'Updated a referral panel settings template',
  })
  update(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: UpdateReferralPanelSettingsDto,
  ) {
    return this.referralPanelSettingsService.update(
      id,
      tenantId,
      dto,
      personId,
    );
  }

  /**
   * Soft-delete a settings template.
   */
  @Delete(':id')
  @Audit({
    module: AuditModule.REFERRAL_PANEL_SETTINGS,
    action: AuditAction.DELETE,
    description: 'Deleted a referral panel settings template',
  })
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.referralPanelSettingsService.remove(id, tenantId);
  }
}
