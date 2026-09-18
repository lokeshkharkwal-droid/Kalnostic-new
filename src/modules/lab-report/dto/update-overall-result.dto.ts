import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * Body for `PATCH /lab-reports/:id/overall-result`. Two independent actions,
 * distinguished by which field is sent — mutually exclusive; sending both or
 * neither is rejected by `LabReportService.updateOverallResult` (a
 * cross-field rule, not expressible with a single-field class-validator
 * decorator):
 * - `templateId` set (`content` omitted): APPLY a template — the server
 *   resolves the named `OverallResultTemplate`'s current `content` itself
 *   (never trusts client-supplied content for an apply) and snapshots it
 *   onto this report, alongside `templateId` for "which one is active".
 * - `content` set (`templateId` omitted): EDIT the already-applied content
 *   in place (post-apply technician edits) — the report's `templateId`
 *   is left untouched, so the UI still shows which template it started from
 *   even after edits diverge from the template's own current text.
 * Both gated by `TechnicianSetting.isOverallResultEditable` (default false),
 * same convention as `UpdateContentSectionsDto`'s 5 fields.
 */
export class UpdateOverallResultDto {
  @IsOptional()
  @IsUUID()
  templateId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  content?: string;
}
