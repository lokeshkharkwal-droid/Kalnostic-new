import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

/**
 * Shared payload for accession action modals that carry no extra field beyond an
 * optional note + attachment (PDF §A.10 — "All modals support optional Notes and
 * Attach File"). Used directly by the note-only actions (acquire / halt / error /
 * hold / retrieve, and the no-status-change Update Sample §A.10.3) and extended by
 * the actions that add a required field. `attachmentUrl` stores a URL only — there
 * is no upload endpoint (plan decision #4). Validated by `class-validator` only.
 */
export class SampleNoteDto {
  /** Optional free-text note recorded on the history entry. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  /** Optional URL of an attached document/image (PDF/JPG/PNG). */
  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(2048)
  attachmentUrl?: string;
}
