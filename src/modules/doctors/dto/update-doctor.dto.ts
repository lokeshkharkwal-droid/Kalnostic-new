import {
  DoctorPaymentMode,
  DoctorStatus,
  DoctorType,
  Gender,
  Salutation,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { DoctorExperienceDto } from './doctor-experience.dto';
import { DoctorQualificationDto } from './doctor-qualification.dto';

/**
 * All fields optional; mirrors CreateDoctorDto (explicit optionals, not
 * `PartialType`). Tenant scope is never accepted here. When `qualifications` or
 * `experiences` is provided it REPLACES the whole set (existing active rows are
 * soft-deleted and the new set is created) — see DoctorsService.update.
 */
export class UpdateDoctorDto {
  @IsEnum(DoctorType)
  @IsOptional()
  doctorType?: DoctorType;

  @IsEnum(Salutation)
  @IsOptional()
  salutation?: Salutation;

  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(255)
  firstName?: string;

  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(255)
  lastName?: string;

  @IsDateString()
  @IsOptional()
  dateOfBirth?: string;

  @IsEnum(Gender)
  @IsOptional()
  gender?: Gender;

  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(20)
  phone?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  alternatePhone?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  address?: string;

  // ── Registration ──
  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(100)
  registrationNo?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  registrationCouncil?: string;

  @IsDateString()
  @IsOptional()
  registrationExpiry?: string;

  // ── Classification (validated against the caller's tenant in the service) ──
  @IsUUID()
  @IsOptional()
  categoryId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  subCategory?: string;

  @IsUUID()
  @IsOptional()
  departmentId?: string;

  // ── Accreditation & signatory authority ──
  @IsBoolean()
  @IsOptional()
  isNablAuthorized?: boolean;

  @IsBoolean()
  @IsOptional()
  isCapCertified?: boolean;

  @IsBoolean()
  @IsOptional()
  isIsoCertified?: boolean;

  @IsBoolean()
  @IsOptional()
  isReportSignatory?: boolean;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  signatoryName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  signatoryDesignation?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1024)
  signatureImagePath?: string;

  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  signatoryDepartmentIds?: string[];

  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  signatoryCategoryIds?: string[];

  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  signatorySubCategoryIds?: string[];

  // ── Fees ──
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  consultationFee?: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  emergencyFee?: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  followUpFee?: number;

  @IsBoolean()
  @IsOptional()
  isAllowDiscount?: boolean;

  // ── Banking ──
  @IsString()
  @IsOptional()
  @MaxLength(255)
  accountHolderName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  bankName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  accountNumber?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  ifscCode?: string;

  @IsEnum(DoctorPaymentMode)
  @IsOptional()
  paymentMode?: DoctorPaymentMode;

  // ── Status & misc ──
  @IsEnum(DoctorStatus)
  @IsOptional()
  status?: DoctorStatus;

  @IsDateString()
  @IsOptional()
  joiningDate?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  remarks?: string;

  // ── Children (replace-on-update) ──
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => DoctorQualificationDto)
  qualifications?: DoctorQualificationDto[];

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => DoctorExperienceDto)
  experiences?: DoctorExperienceDto[];
}
