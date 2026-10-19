import { IsUUID } from 'class-validator';

/**
 * Clone all active radiology tests from the source master data (the
 * `:masterDataId` path param) into the target. The service validates both belong
 * to the caller's tenant and copies each flat test, skipping any whose `testName`
 * or `testCode` already exists (active) in the target.
 */
export class CloneRadiologyTestsDto {
  @IsUUID()
  targetMasterDataId: string;
}
