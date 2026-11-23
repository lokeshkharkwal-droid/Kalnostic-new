import { IsNotEmpty, IsString } from 'class-validator';

/**
 * Switch an authenticated patient session to another of the patient's
 * businesses. The `tenantId` is validated against the person's enrolments.
 */
export class SwitchBusinessDto {
  /** The tenant to switch into (one of the patient's enrolled businesses). */
  @IsString()
  @IsNotEmpty()
  tenantId: string;
}
