import { IsOptional, IsString } from 'class-validator';

/** Body for `POST /lab-reports/:id/re-run` (LABORATORY.docx §5.5). */
export class RaiseReRunDto {
  @IsOptional()
  @IsString()
  notes?: string;
}
