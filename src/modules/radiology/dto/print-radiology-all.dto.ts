import { ArrayNotEmpty, IsArray, IsOptional, IsUUID } from 'class-validator';

/**
 * Body for `POST /radiology/studies/print-all` — the worklist's multi-select
 * "Print Report" action. Renders the chosen (or centrally-resolved)
 * `radiology_all_report` template once over every selected study, combining each
 * study's report body into a single PDF.
 */
export class PrintRadiologyAllDto {
  /** The selected studies, in the order they should appear in the combined PDF. */
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('all', { each: true })
  studyIds: string[];

  /**
   * The `radiology_all_report` template chosen in the picker. Omitted for "Skip
   * Selection", in which case the backend resolves it centrally (Configuration
   * default → first active).
   */
  @IsOptional()
  @IsUUID()
  templateId?: string;
}
