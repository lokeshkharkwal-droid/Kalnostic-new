import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { PatientJwtPayload } from '../types/patient-jwt-payload.type';

/**
 * Injects the authenticated patient payload (set on `req.user` by
 * `PatientJwtGuard`), or a single field when a key is passed.
 *
 * @example me(@CurrentPatient() patient: PatientJwtPayload) {}
 * @example read(@CurrentPatient('tenant_id') tenantId: string) {}
 */
export const CurrentPatient = createParamDecorator(
  (data: keyof PatientJwtPayload | undefined, ctx: ExecutionContext) => {
    const request = ctx
      .switchToHttp()
      .getRequest<{ user?: PatientJwtPayload }>();
    const patient = request.user;
    return data ? patient?.[data] : patient;
  },
);
