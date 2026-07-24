import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query DTO for the lightweight `GET /equipment/options` endpoint
 * (`{ id, name, code }`), used by the Lab Adapter form's Equipment selector.
 * Equipment is platform-level (no tenant), so there is no scoping field here.
 *
 * - `search` — case-insensitive match against the equipment `name`.
 * - `page` / `limit` (inherited) — offset pagination. When `page` is omitted the
 *   endpoint returns the full `{ id, name, code }[]` array; when supplied it
 *   returns a paginated `{ data, total, page, limit }` envelope.
 */
export class EquipmentOptionsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;
}
