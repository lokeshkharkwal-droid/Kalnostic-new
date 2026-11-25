import { IsNotEmpty, IsString } from 'class-validator';

/**
 * Exchange a login bootstrap token + a chosen tenant for a tenant-scoped patient
 * session. The `tenantId` is validated against the person's enrollments (so a
 * client cannot select a business they are not a patient of), mirroring the
 * "never trust a client tenant id without checking it against context" rule.
 */
export class SelectBusinessDto {
  /** The bootstrap token returned by `POST /patient-portal/auth/login`. */
  @IsString()
  @IsNotEmpty()
  bootstrapToken: string;

  /** The tenant the patient chose from the login response's `businesses` list. */
  @IsString()
  @IsNotEmpty()
  tenantId: string;
}
