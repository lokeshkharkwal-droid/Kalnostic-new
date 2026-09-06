import { Body, Controller, Get, Put } from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { ChannelSettingsService } from './services/channel-settings.service';
import { UpdateChannelSettingsDto } from './dto/update-channel-settings.dto';
import { UpsertChannelOverrideDto } from './dto/upsert-channel-override.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Business messaging channel configuration (business-authenticated; tenant + active
 * branch come from the JWT, never the body — CLAUDE.md §4.7). These flags/overrides
 * gate which channels automatic notifications actually send over
 * (`NotificationEnablementService`). The global `JwtAuthGuard` protects all routes.
 */
@Controller('communication/channel-settings')
export class ChannelSettingsController {
  constructor(private readonly channelSettings: ChannelSettingsService) {}

  /** Read the capability flags + per-feature overrides for the active scope. */
  @Get()
  getSettings(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
  ) {
    return this.channelSettings.getSettings(tenantId, profile.branchId);
  }

  /** Partially update the capability flags for the active scope. */
  @Put()
  @Audit({
    module: AuditModule.COMMUNICATION,
    action: AuditAction.UPDATE,
    description: 'Updated messaging channel settings',
  })
  updateSettings(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Body() dto: UpdateChannelSettingsDto,
  ) {
    return this.channelSettings.updateSettings(
      tenantId,
      profile.branchId,
      dto,
      personId,
    );
  }

  /** Upsert one per-(feature, channel) override for the active scope. */
  @Put('overrides')
  @Audit({
    module: AuditModule.COMMUNICATION,
    action: AuditAction.UPDATE,
    description: 'Updated a messaging channel override',
  })
  upsertOverride(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Body() dto: UpsertChannelOverrideDto,
  ) {
    return this.channelSettings.upsertOverride(
      tenantId,
      profile.branchId,
      dto,
      personId,
    );
  }
}
