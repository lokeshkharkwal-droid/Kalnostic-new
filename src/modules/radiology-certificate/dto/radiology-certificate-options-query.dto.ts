import { IsOptional, IsString, IsUUID } from 'class-validator';

/**
 * Query for the trimmed `{ id, name, groupName }` radiology-certificate options
 * list (e.g. selecting a certificate when issuing one). Branch scope comes from
 * the JWT profile; `masterDataId`/`search` narrow the list.
 */
export class RadiologyCertificateOptionsQueryDto {
  @IsOptional()
  @IsUUID()
  masterDataId?: string;

  @IsOptional()
  @IsString()
  search?: string;
}
