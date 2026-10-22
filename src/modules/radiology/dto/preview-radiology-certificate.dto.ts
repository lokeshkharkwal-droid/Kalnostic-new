import { IsOptional, IsUUID } from 'class-validator';

/**
 * Render a radiology certificate template against a study's context WITHOUT
 * saving it — fills the `{placeholder}`s and returns the resolved HTML so the
 * doctor can review/edit before issuing (mirrors EzHealthTrack `showCertificate`).
 */
export class PreviewRadiologyCertificateDto {
  /** The `RadiologyCertificate` template to render. */
  @IsUUID()
  certificateId: string;

  /**
   * Signing reporting-doctor to resolve the `{doctor_name}` / `{signature}` /
   * `{doctor_reg_no}` placeholders with — the doctor chosen in the report modal,
   * which may differ from (or precede) the study's saved `reportingDoctorId`.
   * When omitted, the study's own `reportingDoctorId` is used.
   */
  @IsOptional()
  @IsUUID()
  reportingDoctorId?: string;
}
