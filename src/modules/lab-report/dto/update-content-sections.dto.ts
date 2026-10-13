import { IsOptional, IsString } from 'class-validator';
import { NoteMaxLength } from '../../../common/validators/note-max-length.validator';

/**
 * Body for `PATCH /lab-reports/:id/content-sections`. All 5 fields are
 * PER-REPORT overrides — each one is stored on this `LabReport` row alone
 * (never on the shared `LabTest` master), gated per-field by the branch's
 * `TechnicianSetting.is<Field>Editable` toggles (all default false;
 * LABORATORY.docx §4.5 describes these sections as normally Admin-configured
 * read-only content — a toggle is an explicit opt-in to let a technician
 * override one, per report, without changing what every other order of that
 * test shows). Each field accepts up to `NOTE_MAX_LENGTH` characters of
 * rich-text HTML (Master Data's Notes editor), the SAME limit Master Data
 * enforces for these notes.
 */
export class UpdateContentSectionsDto {
  @IsOptional()
  @IsString()
  @NoteMaxLength('Useful For')
  usefulFor?: string;

  @IsOptional()
  @IsString()
  @NoteMaxLength('Interpretation')
  interpretation?: string;

  @IsOptional()
  @IsString()
  @NoteMaxLength('Limitations')
  limitations?: string;

  @IsOptional()
  @IsString()
  @NoteMaxLength('Remarks')
  remarks?: string;

  @IsOptional()
  @IsString()
  @NoteMaxLength('References')
  references?: string;
}
