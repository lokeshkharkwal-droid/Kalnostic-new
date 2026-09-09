import { IsString, MinLength, MaxLength } from 'class-validator';

/**
 * Query for `GET /patients/cross-tenant-lookup`. A single mobile number to look
 * up across ALL tenants (via the globally-unique `Person.phone`). The number is
 * normalized server-side; an exact (not fuzzy) match is performed.
 */
export class CrossTenantLookupQueryDto {
  @IsString()
  @MinLength(4)
  @MaxLength(30)
  phone: string;
}
