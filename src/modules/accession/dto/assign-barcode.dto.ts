import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * Assign Barcode & Print modal payload (PDF §A.10.2 — available at any status, no
 * status change). `barcode` is optional: when omitted the service assigns the
 * system-generated value (`BAR-#####-A`, derived from the accession number); when
 * supplied it must match that format (editable / scannable per the spec).
 */
export class AssignBarcodeDto {
  /** Barcode to assign. Defaults to the system-generated `BAR-#####-A` when omitted. */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Matches(/^[A-Za-z0-9-]+$/, {
    message: 'barcode may contain only letters, digits and hyphens',
  })
  barcode?: string;
}
