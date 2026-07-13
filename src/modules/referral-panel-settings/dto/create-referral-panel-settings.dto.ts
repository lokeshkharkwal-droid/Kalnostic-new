import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  ReferralBonusType,
  ReferralClientType,
  ReferralPanelSettingsStatus,
} from '@prisma/client';

/**
 * Body for creating a referral panel settings template. `tenantId`/`branchId` are
 * never accepted from the client — they come from the request context. Fields are
 * grouped by the client type they apply to (communication applies to all). The
 * conditional bonus rule (a `bonusType` requires its matching amount) is enforced
 * authoritatively in `ReferralPanelSettingsService`. Validated by `class-validator`
 * only. Boolean fields are `is`-prefixed per CLAUDE.md naming.
 */
export class CreateReferralPanelSettingsDto {
  // ── Identity ──
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  settingName: string;

  @IsEnum(ReferralClientType)
  clientType: ReferralClientType;

  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;

  @IsEnum(ReferralPanelSettingsStatus)
  @IsOptional()
  status?: ReferralPanelSettingsStatus;

  // ── Communication ──
  @IsBoolean()
  @IsOptional()
  isSendBillsToPatient?: boolean;

  @IsBoolean()
  @IsOptional()
  isSendBillsToB2b?: boolean;

  @IsBoolean()
  @IsOptional()
  isSendBillsToDoctor?: boolean;

  @IsBoolean()
  @IsOptional()
  isSendReportsToPatient?: boolean;

  @IsBoolean()
  @IsOptional()
  isSendReportsToB2b?: boolean;

  @IsBoolean()
  @IsOptional()
  isSendReportsToDoctor?: boolean;

  // ── Credit / invoicing (POSTPAID) ──
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  creditLimitAmount?: number;

  @IsBoolean()
  @IsOptional()
  isRestrictOrderCreditLimit?: boolean;

  @IsBoolean()
  @IsOptional()
  isRestrictReportCreditLimit?: boolean;

  @IsInt()
  @Min(0)
  @IsOptional()
  creditAllowedDays?: number;

  @IsBoolean()
  @IsOptional()
  isRestrictOrderCreditDays?: boolean;

  @IsBoolean()
  @IsOptional()
  isRestrictReportCreditDays?: boolean;

  @IsInt()
  @Min(0)
  @IsOptional()
  daysAfterInvoice?: number;

  @IsBoolean()
  @IsOptional()
  isRestrictOrderPostInvoice?: boolean;

  @IsBoolean()
  @IsOptional()
  isRestrictReportPostInvoice?: boolean;

  @IsBoolean()
  @IsOptional()
  isAutoInvoice?: boolean;

  @IsBoolean()
  @IsOptional()
  isRaiseInvoiceOnCreditLimit?: boolean;

  @IsInt()
  @Min(0)
  @IsOptional()
  invoiceFrequencyDays?: number;

  @IsBoolean()
  @IsOptional()
  isOverlapMonthEndClose?: boolean;

  @IsBoolean()
  @IsOptional()
  isAllowManualInvoice?: boolean;

  @IsInt()
  @Min(0)
  @IsOptional()
  invoiceEmailTriggerHours?: number;

  // ── Wallet / bonus (PREPAID) ──
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  minWalletAdvance?: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  minAdvanceForBonus?: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  minWalletBalance?: number;

  @IsBoolean()
  @IsOptional()
  isRestrictOrderAtMinBalance?: boolean;

  @IsBoolean()
  @IsOptional()
  isReminderAt75Percent?: boolean;

  @IsBoolean()
  @IsOptional()
  isReminderAtMinBalance?: boolean;

  @IsEnum(ReferralBonusType)
  @IsOptional()
  bonusType?: ReferralBonusType;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  bonusPercentage?: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  bonusFixedAmount?: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  bonusExtraAmount?: number;

  @IsBoolean()
  @IsOptional()
  isAllowNegativeBalance?: boolean;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  maxNegativeBalance?: number;

  @IsBoolean()
  @IsOptional()
  isRestrictOrderNegative?: boolean;

  @IsBoolean()
  @IsOptional()
  isRestrictReportNegative?: boolean;

  // ── Payment ──
  @IsBoolean()
  @IsOptional()
  isAllowOtherPaymentModes?: boolean;
}
