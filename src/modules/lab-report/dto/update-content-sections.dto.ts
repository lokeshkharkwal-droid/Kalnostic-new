import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Body for `PATCH /lab-reports/:id/content-sections`. All 5 fields are
 * PER-REPORT overrides — each one is stored on this `LabReport` row alone
 * (never on the shared `LabTest` master), gated per-field by the branch's
 * `TechnicianSetting.is<Field>Editable` toggles (all default false;
 * LABORATORY.docx §4.5 describes these sections as normally Admin-configured
 * read-only content — a toggle is an explicit opt-in to let a technician
 * override one, per report, without changing what every other order of that
 * test shows). `@MaxLength(20000)` accommodates rich-text HTML (Master
 * Data's Notes editor), not just plain text.
 */
export class UpdateContentSectionsDto {
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  usefulFor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  interpretation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  limitations?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  remarks?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  references?: string;
}
