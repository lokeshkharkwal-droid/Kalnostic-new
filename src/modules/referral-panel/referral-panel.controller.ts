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
import { ReferralPanelService } from './referral-panel.service';
import { CreateReferralPanelDto } from './dto/create-referral-panel.dto';
import { UpdateReferralPanelDto } from './dto/update-referral-panel.dto';
import { ListReferralPanelsDto } from './dto/list-referral-panels.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Referral-panel endpoints (business-authenticated; tenant comes from the JWT).
 * The global `JwtAuthGuard` protects all routes.
 */
@Controller('referral-panels')
@UseGuards(PermissionGuard)
export class ReferralPanelController {
  constructor(private readonly referralPanelService: ReferralPanelService) {}

  /**
   * Create a referral panel with its assigned lab tests/panels.
   */
  @Post()
  @RequirePermission(PERMISSION_KEYS.BR_REF_ADD_PANEL)
  @Audit({
    module: AuditModule.REFERRAL_PANEL,
    action: AuditAction.CREATE,
    description: 'Created a referral panel',
  })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Body() dto: CreateReferralPanelDto,
  ) {
    return this.referralPanelService.create(
      tenantId,
      profile.branchId,
      personId,
      dto,
    );
  }

  /**
   * List referral panels in the caller's tenant (paginated; optional `search`,
   * `clientType`, `status`, and `branchId`).
   */
  @Get()
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: ListReferralPanelsDto,
  ) {
    return this.referralPanelService.findAll(tenantId, profile.branchId, query);
  }

  /**
   * Fetch one referral panel by id (with assigned lab tests/panels).
   */
  @Get(':id')
  findOne(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('id') id: string,
  ) {
    return this.referralPanelService.findById(id, tenantId, profile.branchId);
  }

  /**
   * Update a referral panel (assigned lab tests/panels are replace-all when sent).
   */
  @Patch(':id')
  @RequirePermission(PERMISSION_KEYS.BR_REF_UPDATE_PANEL)
  @Audit({
    module: AuditModule.REFERRAL_PANEL,
    action: AuditAction.UPDATE,
    description: 'Updated a referral panel',
  })
  update(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: UpdateReferralPanelDto,
  ) {
    return this.referralPanelService.update(
      id,
      tenantId,
      profile.branchId,
      personId,
      dto,
    );
  }

  /**
   * Soft-delete a referral panel (cascades to assigned lab tests/panels).
   */
  @Delete(':id')
  @RequirePermission(PERMISSION_KEYS.BR_REF_DELETE_PANEL)
  @Audit({
    module: AuditModule.REFERRAL_PANEL,
    action: AuditAction.DELETE,
    description: 'Deleted a referral panel',
  })
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.referralPanelService.remove(id, tenantId);
  }
}
