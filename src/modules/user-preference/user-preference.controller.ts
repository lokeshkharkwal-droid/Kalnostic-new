import { Body, Controller, Delete, Get, Param, Put } from '@nestjs/common';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SaveDateFilterPreferenceDto } from './dto/save-date-filter-preference.dto';
import { UserPreferenceService } from './user-preference.service';

/**
 * The signed-in user's own UI preferences. Login-only (global `JwtAuthGuard`, no
 * permission key): tenant and person come from the JWT, so each user can only
 * read or change their own preferences.
 */
@Controller('user-preferences')
export class UserPreferenceController {
  constructor(private readonly userPreferenceService: UserPreferenceService) {}

  /** The caller's default date filter for a screen (`null` when none is saved). */
  @Get('date-filters/:screenKey')
  getDateFilter(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('screenKey') screenKey: string,
  ) {
    return this.userPreferenceService.getDateFilter(
      tenantId,
      personId,
      screenKey,
    );
  }

  /** Save (create or replace) the caller's default date filter for a screen. */
  @Put('date-filters/:screenKey')
  saveDateFilter(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('screenKey') screenKey: string,
    @Body() dto: SaveDateFilterPreferenceDto,
  ) {
    return this.userPreferenceService.saveDateFilter(
      tenantId,
      personId,
      screenKey,
      dto,
    );
  }

  /** Remove the caller's default date filter for a screen (back to Today). */
  @Delete('date-filters/:screenKey')
  resetDateFilter(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('screenKey') screenKey: string,
  ) {
    return this.userPreferenceService.resetDateFilter(
      tenantId,
      personId,
      screenKey,
    );
  }
}
