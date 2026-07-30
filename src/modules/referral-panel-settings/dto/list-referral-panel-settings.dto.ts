import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  ReferralClientType,
  ReferralPanelSettingsStatus,
} from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query parameters for the referral-panel-settings listing endpoint
 * (`GET /referral-panel-settings`). Extends the shared pagination DTO with
 * optional `branchId` / `clientType` / `status` filters and a case-insensitive
 * `search` on `settingName`. Validated by `class-validator` only.
 */
export class ListReferralPanelSettingsDto extends PaginationQueryDto {
  /**
   * Restrict the listing to one branch (exact match). Branch Admin passes the
   * active branch id from the JWT; Business Admin omits it to list all tenant
   * settings.
   */
  @IsString()
  @IsOptional()
  branchId?: string;

  /** Filter by billing client type. */
  @IsEnum(ReferralClientType)
  @IsOptional()
  clientType?: ReferralClientType;

  /** Filter by lifecycle status. */
  @IsEnum(ReferralPanelSettingsStatus)
  @IsOptional()
  status?: ReferralPanelSettingsStatus;

  /** Case-insensitive match against the setting name. */
  @IsString()
  @IsOptional()
  @MaxLength(100)
  search?: string;
}
