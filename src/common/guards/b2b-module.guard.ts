import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { JwtPayload } from '../../modules/auth/types/jwt-payload.type';
import { B2B_ROLE_KEY, isB2bAllowedPath } from './b2b.constants';

/** Strip the global `/api/v1` prefix (if present) so allow-list prefixes match. */
function normalisePath(url: string): string {
  const path = url.split('?')[0] ?? url;
  return path.replace(/^\/api\/v1/, '') || '/';
}

/**
 * Default-deny endpoint gate for B2B Referring Panel sessions: rejects any request
 * whose path is not in the B2B allow-list. A no-op for every non-B2B session.
 * Registered globally, after JwtAuthGuard. Data-row isolation is enforced
 * separately in the services (see B2bScopeGuard); this guard blocks whole
 * endpoints the panel has no business calling.
 */
@Injectable()
export class B2bModuleGuard implements CanActivate {
  /**
   * @param context the current execution context (HTTP)
   * @returns true when allowed; throws ForbiddenException otherwise
   */
  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<{ user?: JwtPayload; url: string }>();
    const user = req.user;
    if (!user || user.active_profile_key !== B2B_ROLE_KEY) return true;

    if (!isB2bAllowedPath(normalisePath(req.url))) {
      throw new ForbiddenException(
        'This module is not available for referral-panel users.',
      );
    }
    return true;
  }
}
