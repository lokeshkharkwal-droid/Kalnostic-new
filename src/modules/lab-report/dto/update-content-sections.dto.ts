import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Body for `PATCH /lab-reports/:id/content-sections`. "Useful For" and
 * "Interpretation" are read from the report's underlying `LabTest` (Admin's
 * lab test configuration, shared across every order of that test) — this
 * endpoint updates that same master record, gated per-field by the branch's
 * `TechnicianSetting.isUsefulForEditable`/`isInterpretationEditable`
 * (LABORATORY.docx §4.5 describes both as normally read-only; the setting is
 * an explicit opt-in override of that default). "Limitations" and
 * "References" are not accepted here — they stay permanently read-only per
 * the same doc section, with no setting to change that.
 */
export class UpdateContentSectionsDto {
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  usefulFor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  interpretation?: string;
}
