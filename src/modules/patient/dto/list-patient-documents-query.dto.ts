import { PatientDocumentCategory } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

/**
 * Query for `GET /patients/:patientId/documents`. Optionally narrows the list to
 * a single category (the Documents tab passes `DOCUMENT`, the Consent tab passes
 * `CONSENT`). Omitting `category` returns both.
 */
export class ListPatientDocumentsQueryDto {
  @IsEnum(PatientDocumentCategory)
  @IsOptional()
  category?: PatientDocumentCategory;
}
