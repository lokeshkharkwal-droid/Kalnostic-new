import { IsOptional, IsString, IsUUID } from 'class-validator';

/** Query for `GET /lab-reports/:id/reference-range`. */
export class ReferenceRangeQueryDto {
  @IsUUID()
  resultParamId: string;

  @IsOptional()
  @IsString()
  methodology?: string;
}
