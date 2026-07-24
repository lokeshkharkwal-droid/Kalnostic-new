import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import {
  AgreementStatus,
  LeadPriority,
  LeadStatus,
  MeetingType,
  PipelineStage,
  SalesDocumentStatus,
} from '@prisma/client';

/**
 * Create a business lead (the 10-section A–J form). `tenantId`/`branchId` come
 * from the JWT context, never the body; `leadCode` is system-generated
 * (CLAUDE.md §4.7). Enum fields are validated against the Prisma enums; open-ended
 * lists (category/organizationType/source/billingType) are validated strings.
 */
export class CreateLeadDto {
  // ── A. Basic ──
  @IsOptional() @IsString() leadAt?: string;
  @IsOptional() @IsUUID() leadOwnerId?: string;
  @IsOptional() @IsUUID() assignedSalespersonId?: string;
  @IsOptional() @IsString() @MaxLength(120) department?: string;
  @IsOptional() @IsUUID() territoryId?: string;
  @IsOptional() @IsEnum(LeadPriority) priority?: LeadPriority;
  @IsOptional() @IsEnum(LeadStatus) status?: LeadStatus;
  @IsString() @MaxLength(120) category: string;
  @IsOptional() @IsNumber() @Min(0) estimatedDealValue?: number;
  @IsOptional() @IsString() expectedClosureDate?: string;
  @IsOptional() @IsInt() @Min(0) probabilityPercent?: number;
  @IsOptional() @IsEnum(PipelineStage) pipelineStage?: PipelineStage;

  // ── B. Organization ──
  @IsString() @MaxLength(255) organizationName: string;
  @IsString() @MaxLength(120) organizationType: string;
  @IsOptional() @IsString() @MaxLength(120) registrationNumber?: string;
  @IsOptional() @IsString() @MaxLength(64) gstNumber?: string;
  @IsOptional() @IsString() @MaxLength(32) pan?: string;
  @IsOptional() @IsString() @MaxLength(255) website?: string;
  @IsOptional() @IsString() @MaxLength(120) organizationSize?: string;
  @IsOptional() @IsInt() @Min(0) numberOfBranches?: number;
  @IsOptional() @IsInt() @Min(0) annualPatientVolume?: number;
  @IsOptional() @IsInt() @Min(0) monthlyReferralPotential?: number;
  @IsOptional() @IsString() @MaxLength(255) existingDiagnosticPartner?: string;
  @IsOptional() @IsString() @MaxLength(255) competitorName?: string;

  // ── C. Contact ──
  @IsString() @MaxLength(255) primaryContactName: string;
  @IsOptional() @IsString() @MaxLength(120) designation?: string;
  @IsOptional() @IsString() @MaxLength(120) contactDepartment?: string;
  @IsString() @MaxLength(20) mobile: string;
  @IsOptional() @IsString() @MaxLength(20) alternateMobile?: string;
  @IsOptional() @IsString() @MaxLength(20) whatsapp?: string;
  @IsOptional() @IsString() @MaxLength(20) landline?: string;
  @IsOptional() @IsString() @MaxLength(255) email?: string;
  @IsOptional() @IsString() @MaxLength(20) preferredContact?: string;
  @IsOptional() @IsBoolean() isDecisionMaker?: boolean;
  @IsOptional() @IsBoolean() isInfluencer?: boolean;

  // ── D. Address ──
  @IsOptional() @IsString() @MaxLength(120) country?: string;
  @IsOptional() @IsString() @MaxLength(120) state?: string;
  @IsOptional() @IsString() @MaxLength(120) district?: string;
  @IsOptional() @IsString() @MaxLength(120) city?: string;
  @IsOptional() @IsString() @MaxLength(120) area?: string;
  @IsOptional() @IsString() @MaxLength(500) addressLine?: string;
  @IsOptional() @IsString() @MaxLength(16) pincode?: string;
  @IsOptional() @IsString() @MaxLength(255) landmark?: string;
  @IsOptional() @IsString() @MaxLength(120) geoLocation?: string;
  @IsOptional() @IsInt() @Min(0) distanceFromBranch?: number;

  // ── E. Source ──
  @IsString() @MaxLength(120) source: string;
  @IsOptional() @IsString() @MaxLength(255) sourcePersonName?: string;
  @IsOptional() @IsString() @MaxLength(20) sourceContactNumber?: string;
  @IsOptional() @IsString() @MaxLength(2000) sourceRemarks?: string;

  // ── F. Requirement ──
  @IsOptional() @IsString() @MaxLength(500) serviceInterestedIn?: string;
  @IsOptional() @IsString() @MaxLength(500) testMenuRequired?: string;
  @IsOptional() @IsString() @MaxLength(255) packageRequired?: string;
  @IsOptional() @IsInt() @Min(0) expectedMonthlyVolume?: number;
  @IsOptional() @IsNumber() @Min(0) expectedMonthlyRevenue?: number;
  @IsOptional() @IsInt() @Min(0) expectedDiscountPercent?: number;
  @IsOptional() @IsBoolean() isCreditRequired?: boolean;
  @IsOptional() @IsInt() @Min(0) creditDaysRequired?: number;
  @IsOptional() @IsString() @MaxLength(64) billingType?: string;
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  requiredIntegrations?: string[];
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  requiredDocuments?: string[];

  // ── G. Meeting planning ──
  @IsOptional() @IsEnum(MeetingType) meetingType?: MeetingType;
  @IsOptional() @IsString() meetingDate?: string;
  @IsOptional() @IsString() @MaxLength(8) meetingTime?: string;
  @IsOptional() @IsString() @MaxLength(255) meetingLocation?: string;
  @IsOptional() @IsString() @MaxLength(2000) meetingAgenda?: string;
  @IsOptional() @IsString() @MaxLength(500) expectedAttendees?: string;
  @IsOptional() @IsBoolean() isReminderRequired?: boolean;
  @IsOptional() @IsString() reminderAt?: string;

  // ── H. Commercial ──
  @IsOptional() @IsNumber() @Min(0) mrpValue?: number;
  @IsOptional() @IsInt() @Min(0) offeredDiscountPercent?: number;
  @IsOptional() @IsBoolean() isSpecialRateCardRequired?: boolean;
  @IsOptional() @IsBoolean() isCommissionRequired?: boolean;
  @IsOptional() @IsInt() @Min(0) referralCommissionPercent?: number;
  @IsOptional() @IsInt() @Min(0) revenueSharePercent?: number;
  @IsOptional() @IsInt() @Min(0) expectedMargin?: number;
  @IsOptional() @IsString() @MaxLength(500) paymentTerms?: string;
  @IsOptional() @IsBoolean() isSecurityDepositRequired?: boolean;
  @IsOptional() @IsBoolean() isAgreementRequired?: boolean;
  @IsOptional() @IsBoolean() isTdsApplicable?: boolean;
  @IsOptional() @IsBoolean() isGstApplicable?: boolean;

  // ── I. Compliance / Legal ──
  @IsOptional() @IsBoolean() isNdaRequired?: boolean;
  @IsOptional() @IsEnum(AgreementStatus) agreementStatus?: AgreementStatus;
  @IsOptional() @IsString() agreementStartDate?: string;
  @IsOptional() @IsString() agreementEndDate?: string;
  @IsOptional() @IsString() @MaxLength(120) documentVerificationStatus?: string;
  @IsOptional() @IsString() @MaxLength(120) licenseVerificationStatus?: string;
  @IsOptional() @IsBoolean() isNablRequired?: boolean;
  @IsOptional() @IsString() @MaxLength(500) dataPrivacyRequirement?: string;
  @IsOptional() @IsBoolean() hasReportSharingConsent?: boolean;
  @IsOptional() @IsString() @MaxLength(255) authorizedSignatoryName?: string;
  @IsOptional() @IsString() @MaxLength(20) authorizedSignatoryContact?: string;

  // ── J. Notes & attachments (URL strings only) ──
  @IsOptional() @IsString() @MaxLength(4000) internalNotes?: string;
  @IsOptional() @IsString() @MaxLength(4000) clientNotes?: string;
  @IsOptional() @IsString() @MaxLength(4000) visitNotes?: string;
  @IsOptional() @IsString() @MaxLength(4000) objectionsRaised?: string;
  @IsOptional() @IsString() @MaxLength(1000) proposalFileUrl?: string;
  @IsOptional() @IsString() @MaxLength(1000) quotationFileUrl?: string;
  @IsOptional() @IsString() @MaxLength(1000) agreementFileUrl?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) attachments?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) otherDocuments?: string[];

  // ── Derived / status ──
  @IsOptional() @IsString() nextFollowUpDate?: string;
  @IsOptional()
  @IsEnum(SalesDocumentStatus)
  proposalStatus?: SalesDocumentStatus;
  @IsOptional()
  @IsEnum(SalesDocumentStatus)
  quotationStatus?: SalesDocumentStatus;
}
