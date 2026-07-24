import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * Shared body shape for the per-test actions that take Notes + (optionally)
 * Attach Files (LABORATORY.docx §5 — Lock Test, Delta Check, Inform Critical
 * Alert, Out of Range, Re-Run Request, Update Status). Attachments themselves
 * are uploaded via the separate `/attachments` endpoint and referenced by id;
 * this DTO only carries the free-text notes for the action being performed.
 */
export class ActionNotesDto {
  @IsOptional()
  @IsString()
  notes?: string;
}

/** Notes are mandatory for this action (Reject, Error Reported). */
export class RequiredActionNotesDto {
  @IsString()
  @IsNotEmpty()
  notes: string;
}
