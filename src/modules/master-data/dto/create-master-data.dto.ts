import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Body for manually creating a master data. `branchId` is one of the few places
 * a branch id legitimately arrives from the client (the caller is *choosing* the
 * branch); the service validates it belongs to the caller's tenant and rejects
 * the main branch (CLAUDE.md §4.7). To seed the new master data with lab tests,
 * use the lab-test clone endpoint afterwards.
 */
export class CreateMasterDataDto {
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
