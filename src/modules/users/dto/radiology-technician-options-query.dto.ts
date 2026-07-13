import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query DTO for the lightweight `GET /radiology-technicians/options` endpoint
 * (id + name only), used by the Create-Order Radiology section's Technician
 * picker. The active branch is resolved from the JWT profile (never the body),
 * so there is no `branchId` here.
 *
 * - `search` — case-insensitive match against the technician Person's name.
 * - `page` / `limit` (inherited) — offset pagination. When `page` is omitted the
 *   endpoint returns the full `{ id, name }[]` array; when supplied it returns a
 *   paginated `{ data, total, page, limit }` envelope.
 */
export class RadiologyTechnicianOptionsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
