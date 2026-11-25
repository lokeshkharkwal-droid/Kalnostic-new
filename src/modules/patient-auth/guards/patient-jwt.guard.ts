import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { UnauthorisedException } from '../../../common/exceptions/kaltros.exception';
import { ALLOW_TEMP_PASSWORD_KEY } from '../decorators/allow-temp-password.decorator';
import { PatientPasswordChangeRequiredException } from '../exceptions/patient-auth.exceptions';
import { PatientJwtPayload } from '../types/patient-jwt-payload.type';

/**
 * Protects patient-portal routes: validates the `'jwt-patient'` token, then —
 * unless the route is `@AllowTempPassword()` — default-denies sessions that are
 * still on the staff-issued temp password, forcing a password change first.
 *
 * Applied directly on the patient controller (the controller is `@Public()` so
 * the global business `JwtAuthGuard` skips it). The validated payload lands on
 * `req.user`, so the global `TenantContextInterceptor` picks up `tenant_id` and
 * the normal RLS tenant scoping applies to patient reads.
 */
@Injectable()
export class PatientJwtGuard
  extends AuthGuard('jwt-patient')
  implements CanActivate
{
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Step 1 — validate the token signature + `type` via the 'jwt-patient' strategy.
    const valid = (await super.canActivate(context)) as boolean;
    if (!valid) {
      throw new UnauthorisedException('Patient authentication required');
    }

    // Step 2 — temp-password gate. A session still on the fixed temp password may
    // only reach routes explicitly marked @AllowTempPassword() (change-password).
    const request = context
      .switchToHttp()
      .getRequest<{ user?: PatientJwtPayload }>();
    const patient = request.user;
    if (!patient) {
      throw new UnauthorisedException('Patient authentication required');
    }
    if (patient.must_change_password) {
      const allowed = this.reflector.getAllAndOverride<boolean>(
        ALLOW_TEMP_PASSWORD_KEY,
        [context.getHandler(), context.getClass()],
      );
      if (!allowed) {
        throw new PatientPasswordChangeRequiredException();
      }
    }
    return true;
  }

  /** Return our typed exception instead of Passport's default 401. */
  handleRequest<TUser = unknown>(err: unknown, user: TUser): TUser {
    if (err || !user) {
      if (err instanceof HttpException) {
        throw err;
      }
      throw new UnauthorisedException('Invalid or expired patient token');
    }
    return user;
  }
}
