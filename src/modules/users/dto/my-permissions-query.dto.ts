import { IsNotEmpty, IsString } from 'class-validator';

/** Query for the current user's permissions at a specific branch. */
export class MyPermissionsQueryDto {
  /** Branch to resolve permissions for (must belong to the caller's tenant). */
  @IsString()
  @IsNotEmpty()
  branchId: string;
}
