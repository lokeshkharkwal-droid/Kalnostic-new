import { IsUUID } from 'class-validator';

/**
 * Clone all active lab tests from the source master data (the `:masterDataId`
 * path param) into the target. The service validates both belong to the caller's
 * tenant and deep-copies each test + its children, skipping any whose `testName`
 * or `testCode` already exists (active) in the target.
 */
export class CloneLabTestsDto {
  @IsUUID()
  targetMasterDataId: string;
}
