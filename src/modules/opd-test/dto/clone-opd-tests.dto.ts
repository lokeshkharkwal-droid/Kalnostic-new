import { IsUUID } from 'class-validator';

/**
 * Clone all active opd tests from the source master data (the
 * `:masterDataId` path param) into the target. The service validates both belong
 * to the caller's tenant and deep-copies each test + children, skipping duplicates.
 */
export class CloneOpdTestsDto {
  @IsUUID()
  targetMasterDataId: string;
}
