import { IsBoolean, IsOptional } from 'class-validator';

/**
 * Partial update of the business's messaging channel capability
 * (PUT /communication/channel-settings). Only the supplied flags are changed; a
 * missing settings row is created with defaults (all channels enabled) on first
 * write. Scope (tenant + active branch) comes from the JWT, never the body.
 */
export class UpdateChannelSettingsDto {
  /** When false, Email is suppressed for every automatic notification in scope. */
  @IsBoolean()
  @IsOptional()
  isEmailChannelEnabled?: boolean;

  /** When false, SMS is suppressed for every automatic notification in scope. */
  @IsBoolean()
  @IsOptional()
  isSmsChannelEnabled?: boolean;

  /** When false, WhatsApp is suppressed for every automatic notification in scope. */
  @IsBoolean()
  @IsOptional()
  isWhatsappChannelEnabled?: boolean;
}
