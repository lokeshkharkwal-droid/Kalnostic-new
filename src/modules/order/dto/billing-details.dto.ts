import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Billing-type-specific sub-form captured on an order/quotation. Exactly which
 * group is populated depends on the order's `billingType` (insurance / corporate /
 * government scheme / TPA); all fields are optional free text so the whole
 * sub-section round-trips on edit. Stored as JSON on `Order.billingDetails` and
 * mirrors the FE `useOrderMeta` billing fields verbatim.
 */
export class BillingDetailsDto {
  /* Insurance */
  @IsOptional() @IsString() @MaxLength(255) insProvider?: string;
  @IsOptional() @IsString() @MaxLength(255) insPolicyNo?: string;
  @IsOptional() @IsString() @MaxLength(255) insType?: string;
  @IsOptional() @IsString() @MaxLength(255) insPolicyHolder?: string;
  @IsOptional() @IsString() @MaxLength(255) insTpaName?: string;
  @IsOptional() @IsString() @MaxLength(255) insPolicyStart?: string;
  @IsOptional() @IsString() @MaxLength(255) insPolicyEnd?: string;
  @IsOptional() @IsString() @MaxLength(255) insCoverageType?: string;
  @IsOptional() @IsString() @MaxLength(255) insTpaApproval?: string;
  @IsOptional() @IsString() @MaxLength(255) insPreAuthStatus?: string;
  @IsOptional() @IsString() @MaxLength(255) insApprovedAmount?: string;

  /* Corporate */
  @IsOptional() @IsString() @MaxLength(255) corpCompany?: string;
  @IsOptional() @IsString() @MaxLength(255) corpEmployeeId?: string;
  @IsOptional() @IsString() @MaxLength(255) corpDepartment?: string;
  @IsOptional() @IsString() @MaxLength(255) corpApprovalRequired?: string;
  @IsOptional() @IsString() @MaxLength(255) corpApprovalNumber?: string;

  /* Government scheme */
  @IsOptional() @IsString() @MaxLength(255) govSchemeName?: string;
  @IsOptional() @IsString() @MaxLength(255) govBeneficiaryId?: string;
  @IsOptional() @IsString() @MaxLength(255) govVerified?: string;

  /* TPA */
  @IsOptional() @IsString() @MaxLength(255) tpaDirectName?: string;
  @IsOptional() @IsString() @MaxLength(255) tpaAuthNumber?: string;
  @IsOptional() @IsString() @MaxLength(255) tpaApprovalStatus?: string;
}
