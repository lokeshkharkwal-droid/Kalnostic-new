import { IsUUID } from 'class-validator';

/** Query for `GET /lab-reports/:id/reference-range/methods`. */
export class ReferenceRangeMethodsQueryDto {
  @IsUUID()
  resultParamId: string;
}
