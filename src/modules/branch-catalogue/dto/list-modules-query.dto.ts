import { IsOptional, IsString } from 'class-validator';

/**
 * Query params for `GET /modules`.
 *
 * The param is snake_case (`branch_type`) per the API contract, so the DTO
 * property is named to match — the global ValidationPipe runs with
 * `whitelist` + `forbidNonWhitelisted`, which would reject a camelCase alias.
 * Whether the value is a real branch type is validated in the service so the
 * 400 response can list the available types.
 */
export class ListModulesQueryDto {
  @IsOptional()
  @IsString()
  branch_type?: string;
}
