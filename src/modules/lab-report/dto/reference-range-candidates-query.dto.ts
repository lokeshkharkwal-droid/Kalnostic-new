import { IsUUID } from 'class-validator';

/** Query for `GET /lab-reports/:id/reference-range/candidates`. */
export class ReferenceRangeCandidatesQueryDto {
  @IsUUID()
  resultParamId: string;
}
