import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Body for manually creating a radiology master data. `branchId` is one of the
 * few places a branch id legitimately arrives from the client (the caller is
 * *choosing* the branch); the service validates it belongs to the caller's tenant
 * (CLAUDE.md §4.7).
 */
export class CreateRadiologyMasterDataDto {
  @IsUUID()
  branchId: string;

  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  description?: string;
}
