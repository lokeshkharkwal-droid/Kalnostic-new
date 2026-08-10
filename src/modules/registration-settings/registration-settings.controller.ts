import {
  Body,
  Controller,
  Get,
  ParseEnumPipe,
  Put,
  Query,
} from '@nestjs/common';
import { AuditAction, AuditModule, ExternalIdPurpose } from '@prisma/client';
import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { RegistrationSettingsService } from './registration-settings.service';
import { SaveRegistrationSettingsDto } from './dto/save-registration-settings.dto';
import { ExternalIdService } from './external-id.service';

/**
 * Registration settings endpoints (LIMS Settings doc "Registration Module").
 * Business-authenticated; tenant from the JWT, branch from the active
 * profile. `GET` returns the effective settings (created with defaults on
 * first access); `PUT` upserts the active branch's settings as a partial
 * patch.
 */
@Controller('registration-settings')
export class RegistrationSettingsController {
  constructor(
    private readonly registrationSettingsService: RegistrationSettingsService,
    private readonly externalIdService: ExternalIdService,
  ) {}

  /** Select/list enum values for the frontend controls. */
  @Get('enums')
  getEnums() {
    return this.registrationSettingsService.getEnums();
  }

  /**
   * Peek the next external Order/Quote id the active branch would generate
   * from its configured format — used by the create form to show a disabled
   * preview. Returns `{ format, value: null }` when the format is NONE
   * (operator enters the id manually). Does not bump the counter.
   */
  @Get('external-id/preview')
  previewExternalId(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query('purpose', new ParseEnumPipe(ExternalIdPurpose))
    purpose: ExternalIdPurpose,
  ) {
    return this.externalIdService.previewNext(
      tenantId,
      profile.branchId ?? '',
      purpose,
    );
  }

  /** Effective Registration settings for the active branch. */
  @Get()
  getSettings(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
  ) {
    return this.registrationSettingsService.getForBranch(
      tenantId,
      profile.branchId ?? '',
    );
  }

  /** Save (partial patch, upsert) the active branch's Registration settings. */
  @Put()
  @Audit({
    module: AuditModule.REGISTRATION_SETTINGS,
    action: AuditAction.UPDATE,
    description: 'Updated registration settings',
  })
  saveSettings(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Body() dto: SaveRegistrationSettingsDto,
  ) {
    return this.registrationSettingsService.saveForBranch(
      tenantId,
      profile.branchId ?? '',
      dto,
    );
  }
}
