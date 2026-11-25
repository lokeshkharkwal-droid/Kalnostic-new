import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload } from '../types/jwt-payload.type';
import {
  PATIENT_ACCESS_TOKEN_TYPE,
  PATIENT_BOOTSTRAP_TOKEN_TYPE,
} from '../../patient-auth/constants/patient-auth.constant';

/** Token `type` values that belong to the patient portal, never to staff. */
const PATIENT_TOKEN_TYPES: readonly string[] = [
  PATIENT_ACCESS_TOKEN_TYPE,
  PATIENT_BOOTSTRAP_TOKEN_TYPE,
];

/**
 * Business JWT strategy (`'jwt'`) — validates access tokens on protected
 * requests. No DB lookup: the token is self-contained (CLAUDE.md §5.1). The
 * validated payload becomes `req.user`.
 *
 * Patient-portal tokens share `JWT_SECRET`, so they are told apart by their
 * `type` claim and rejected here. Staff tokens issued before patient login
 * existed carry no `type`, so this is a deny-list, not a "must be business"
 * check (which would log every staff member out).
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false, // expired tokens fail → client must refresh
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
    });
  }

  /**
   * Runs after the signature + expiry are verified.
   * @param payload the decoded JWT payload
   * @throws UnauthorizedException if the token is malformed or is a
   *   patient-portal token
   */
  validate(payload: JwtPayload): JwtPayload {
    const tokenType = (payload as { type?: unknown }).type;
    if (
      typeof tokenType === 'string' &&
      PATIENT_TOKEN_TYPES.includes(tokenType)
    ) {
      throw new UnauthorizedException(
        'Patient token is not valid for business access',
      );
    }
    if (!payload.person_id) {
      throw new UnauthorizedException('Malformed token: missing person_id');
    }
    return payload;
  }
}
