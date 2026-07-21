import {
  AgeType,
  BloodGroup,
  Gender,
  MaritalStatus,
  PatientCategory,
  PatientStatus,
  Relationship,
  Salutation,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { MedicalHistoryDto } from './medical-history.dto';

const AADHAAR = /^\d{12}$/;
const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/**
 * Body for `POST /patients`. Only `firstName` and `mobile` are required; the
 * rest are optional. `tenantId` (JWT) and the registration `branchId` (active
 * profile) are set from the request context and never accepted here
 * (CLAUDE.md §4.7). An optional `medicalHistories` array creates the patient's
 * first history record(s) atomically in the same request.
 */
export class CreatePatientDto {
  // ── Identity ──
  @IsEnum(Salutation)
  @IsOptional()
  salutation?: Salutation;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  firstName: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  middleName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  lastName?: string;

  @IsEnum(Gender)
  @IsOptional()
  gender?: Gender;

  @IsEnum(BloodGroup)
  @IsOptional()
  bloodGroup?: BloodGroup;

  @IsEnum(Relationship)
  @IsOptional()
  relationship?: Relationship;

  @IsDateString()
  @IsOptional()
  dateOfBirth?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  age?: number;

  @IsEnum(AgeType)
  @IsOptional()
  ageType?: AgeType;

  // ── Contact ──
  @IsString()
  @MinLength(4)
  @MaxLength(30)
  mobile: string;

  @IsString()
  @IsOptional()
  @MaxLength(30)
  whatsappNumber?: string;

  @IsEmail()
  @IsOptional()
  @MaxLength(255)
  email?: string;

  @IsEmail()
  @IsOptional()
  @MaxLength(255)
  alternateEmail?: string;

  @IsString()
  @IsOptional()
  @MaxLength(30)
  alternateMobileNumber?: string;

  // ── Address ──
  @IsString()
  @IsOptional()
  @MaxLength(120)
  country?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  addressLine1?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  addressLine2?: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  area?: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  city?: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  state?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  pincode?: string;

  // ── Privilege / category ──
  @IsBoolean()
  @IsOptional()
  hasPrivilegeCard?: boolean;

  @IsString()
  @IsOptional()
  @MaxLength(60)
  privilegeNumber?: string;

  @IsEnum(PatientCategory)
  @IsOptional()
  patientCategory?: PatientCategory;

  @IsEnum(MaritalStatus)
  @IsOptional()
  maritalStatus?: MaritalStatus;

  // ── Lifecycle ──
  @IsEnum(PatientStatus)
  @IsOptional()
  status?: PatientStatus;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  // ── Identity documents ──
  @IsString()
  @IsOptional()
  @MaxLength(60)
  umId?: string;

  @Matches(AADHAAR, { message: 'aadhaarNumber must be 12 digits' })
  @IsOptional()
  aadhaarNumber?: string;

  @Matches(PAN, { message: 'panNumber must match ABCDE1234F' })
  @IsOptional()
  panNumber?: string;

  @IsString()
  @IsOptional()
  @MaxLength(30)
  passportNumber?: string;

  // ── Guardian ──
  @IsString()
  @IsOptional()
  @MaxLength(255)
  guardianName?: string;

  @IsEnum(Relationship)
  @IsOptional()
  guardianRelationship?: Relationship;

  @IsEmail()
  @IsOptional()
  @MaxLength(255)
  guardianEmail?: string;

  @IsString()
  @IsOptional()
  @MaxLength(30)
  guardianMobileNumber?: string;

  // ── Emergency contact ──
  @IsString()
  @IsOptional()
  @MaxLength(255)
  emergencyContactName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(30)
  emergencyContactMobileNumber?: string;

  // ── Medical history (optional; created in the same transaction) ──
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => MedicalHistoryDto)
  medicalHistories?: MedicalHistoryDto[];
}
