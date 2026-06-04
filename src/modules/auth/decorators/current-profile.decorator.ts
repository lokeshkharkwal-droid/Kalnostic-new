import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedRequest } from '../types/jwt-payload.type';

/** The active profile/branch context resolved from the JWT. */
export interface ActiveProfile {
  profileKey: string | null;
  branchId: string | null;
}

/**
 * Injects the active profile context (`active_profile_key` + `active_branch_id`)
 * from the authenticated user's JWT.
 */
export const CurrentProfile = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ActiveProfile => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return {
      profileKey: request.user.active_profile_key,
      branchId: request.user.active_branch_id,
    };
  },
);
