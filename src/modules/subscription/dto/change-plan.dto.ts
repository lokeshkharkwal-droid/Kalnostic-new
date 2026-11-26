import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

/**
 * Body for `POST /subscription/change-plan` — the plan the business selects in the
 * "Change Plan" modal. The business id is resolved from the JWT tenant, never the
 * body; only the chosen plan is accepted from the client.
 */
export class ChangePlanDto {
  /** The subscription server plan id to switch to. */
  @IsString()
  @MinLength(1)
  planId: string;

  /** Optional plan code/slug, when the server is keyed by code instead of id. */
  @IsString()
  @IsOptional()
  planCode?: string;

  /** Make this the business's default plan. Defaults to false. */
  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;
}
