import { IsOptional, IsString, IsUUID } from 'class-validator';

/**
 * Issue (save) a radiology certificate against a study — the second tier from
 * EzHealthTrack (`saveCertificate` → `rad_certificate_history`). `content` is the
 * final (optionally edited) HTML; when omitted the server renders it fresh from
 * the template against the study's context.
 */
export class IssueRadiologyCertificateDto {
  /** The `RadiologyCertificate` template this is issued from. */
  @IsUUID()
  certificateId: string;

  /** The final certificate HTML (defaults to the freshly-rendered template). */
  @IsOptional()
  @IsString()
  content?: string;
}
