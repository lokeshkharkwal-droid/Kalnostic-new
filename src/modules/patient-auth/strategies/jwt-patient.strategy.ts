import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PatientJwtPayload } from '../types/patient-jwt-payload.type';
import { PATIENT_ACCESS_TOKEN_TYPE } from '../constants/patient-auth.constant';

/**
 * Patient-portal JWT strategy (`'jwt-patient'`). Shares `JWT_SECRET` but a
 * separate strategy name; the `type: 'patient'` check stops a business or
 * SiteAdmin token being accepted here. The reverse is enforced in
 * `JwtStrategy.validate`, which rejects `patient` / `patient_bootstrap` token
 * types on the global business `'jwt'` guard. No DB
 * lookup: the token is self-contained. The validated payload becomes `req.user`.
 */
@Injectable()
export class JwtPatientStrategy extends PassportStrategy(
  Strategy,
  'jwt-patient',
) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
    });
  }

  /**
   * Runs after the signature + expiry are verified.
   * @param payload the decoded JWT payload
   * @throws UnauthorizedException if not a patient token or malformed
   */
  validate(payload: PatientJwtPayload): PatientJwtPayload {
    if (payload.type !== PATIENT_ACCESS_TOKEN_TYPE) {
      throw new UnauthorizedException('Invalid token type for patient access');
    }
    if (!payload.person_id || !payload.patient_id || !payload.tenant_id) {
      throw new UnauthorizedException('Malformed patient token');
    }
    return payload;
  }
}
