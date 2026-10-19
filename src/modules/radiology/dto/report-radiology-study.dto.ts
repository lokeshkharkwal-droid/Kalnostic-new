import { IsOptional, IsString, IsUUID } from 'class-validator';
import { RadiologyStudyActionDto } from './radiology-study-action.dto';

/**
 * Payload for the `report` action — fill (or edit) the narrative radiology report.
 * Findings/impression/recommendation are rich text (the FE sends HTML). The
 * report template drives the published PDF (Phase 3.5). Extends the shared action
 * payload so a report submission can also carry a note.
 */
export class ReportRadiologyStudyDto extends RadiologyStudyActionDto {
  /** The detailed narrative findings. */
  @IsOptional()
  @IsString()
  findings?: string;

  /** The summary / clinical impression. */
  @IsOptional()
  @IsString()
  impression?: string;

  /** Optional follow-up / referral recommendation. */
  @IsOptional()
  @IsString()
  recommendation?: string;

  /** The report/certificate template to render this study's PDF with (Phase 3.5). */
  @IsOptional()
  @IsUUID()
  reportTemplateId?: string;

  /** Optional radiologist override for this report (a staff Person id). */
  @IsOptional()
  @IsUUID()
  radiologistId?: string;

  /** Optional reporting-doctor signatory (a RadiologyReportingDoctor id). */
  @IsOptional()
  @IsUUID()
  reportingDoctorId?: string;
}
