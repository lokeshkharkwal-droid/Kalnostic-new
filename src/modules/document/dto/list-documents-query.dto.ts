import { DocumentStatus, DocumentType } from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query DTO for listing documents — offset pagination plus optional filters.
 * All filters are scoped to the caller's tenant + active branch in the service.
 * `search` matches the `documentNumber` or `title` (case-insensitive).
 */
export class ListDocumentsQueryDto extends PaginationQueryDto {
  /** Case-insensitive match against the document number or title. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsEnum(DocumentStatus)
  @IsOptional()
  status?: DocumentStatus;

  @IsEnum(DocumentType)
  @IsOptional()
  documentType?: DocumentType;

  @IsUUID()
  @IsOptional()
  categoryId?: string;

  @IsUUID()
  @IsOptional()
  departmentId?: string;
}
