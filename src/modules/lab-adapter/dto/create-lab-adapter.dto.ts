import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/**
 * Create a lab adapter. `name` is required and unique per tenant among active
 * adapters. `equipmentId` references a global (SITE_ADMIN) equipment. `branchIds`
 * is the set of the tenant's branches the adapter is assigned to; `labTestIds` is
 * the set of branch lab tests the instrument reports (both validated in
 * `LabAdapterService` and persisted into `LabAdapterBranch` / `LabAdapterTest`).
 * The `token` is system-generated — never sent by the client. `tenantId` /
 * `branchId` come from the JWT context, never the body (CLAUDE.md §4.7).
 */
export class CreateLabAdapterDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  /** Global (SITE_ADMIN) equipment this adapter integrates. */
  @IsUUID('4')
  equipmentId: string;

  /** Branch ids (of the caller's tenant) the adapter is assigned to. */
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayUnique()
  branchIds: string[];

  /** Branch-lab-test ids the instrument reports. Optional. */
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayUnique()
  labTestIds?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
