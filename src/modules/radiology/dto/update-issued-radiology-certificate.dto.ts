import { IsString } from 'class-validator';

/** Re-edit the HTML of an already-issued radiology certificate. */
export class UpdateIssuedRadiologyCertificateDto {
  /** The revised certificate HTML. */
  @IsString()
  content: string;
}
