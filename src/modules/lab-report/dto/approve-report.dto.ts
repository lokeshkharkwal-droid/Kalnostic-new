import { IsOptional, IsString, IsUUID } from 'class-validator';

/**
 * Body for `POST /lab-reports/:id/approve`. The 3 signatory fields are all
 * optional at the DTO level — whether `signatoryAuthority1Id` is actually
 * mandatory depends on whether the report's department has any signatory
 * candidates configured at all (LabReportService.approve validates this
 * dynamically; a static @IsNotEmpty can't express that condition). Each id,
 * when present, must match a candidate returned by
 * `GET /lab-reports/:id/signatory-candidates` at approve time — re-validated
 * server-side, not trusted from whatever the client fetched when the modal
 * opened.
 */
export class ApproveReportDto {
  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsUUID()
  signatoryAuthority1Id?: string;

  @IsOptional()
  @IsUUID()
  signatoryAuthority2Id?: string;

  @IsOptional()
  @IsUUID()
  signatoryAuthority3Id?: string;
}
