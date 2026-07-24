import { IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { SalesDocumentStatus } from '@prisma/client';

/**
 * Attach a proposal / quotation / agreement document URL to a lead (URL strings
 * only — no upload pipeline in this phase). Updates the matching file field and,
 * for proposal/quotation, the corresponding status.
 */
export class UploadLeadDocumentDto {
  @IsIn(['proposal', 'quotation', 'agreement']) docType:
    | 'proposal'
    | 'quotation'
    | 'agreement';

  @IsString() @MaxLength(1000) url: string;

  /** For proposal/quotation: the new document status (defaults to SHARED). */
  @IsOptional() @IsEnum(SalesDocumentStatus) status?: SalesDocumentStatus;
}
