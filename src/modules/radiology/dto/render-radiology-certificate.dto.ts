import { IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

/**
 * Render the CURRENT (edited) certificate HTML to a PDF WITHOUT saving — the
 * report modal's "Print Certificate" action. The certificate is the single
 * source of truth: the `content` is the doctor's already-rendered, visually
 * edited document, printed verbatim (no placeholder re-resolution). The optional
 * `certificateId` only supplies the PDF's title (the template name).
 */
export class RenderRadiologyCertificateDto {
  /** The final, edited certificate HTML to print. */
  @IsString()
  @MinLength(1)
  content: string;

  /** The source template id — used only to title the PDF. */
  @IsOptional()
  @IsUUID()
  certificateId?: string;
}
