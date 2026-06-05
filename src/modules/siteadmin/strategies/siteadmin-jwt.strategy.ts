import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { SiteAdminJwtPayload } from '../types/siteadmin-jwt.type';

/**
 * SiteAdmin JWT strategy (`'jwt-siteadmin'`). Shares `JWT_SECRET` but a separate
 * strategy name; the `type: 'siteadmin'` check stops a business token being
 * accepted here (CLAUDE.md §5.2).
 */
@Injectable()
export class SiteAdminJwtStrategy extends PassportStrategy(
  Strategy,
  'jwt-siteadmin',
) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
    });
  }

  /**
   * @param payload decoded JWT payload
   * @throws UnauthorizedException if not a siteadmin token or malformed
   */
  validate(payload: SiteAdminJwtPayload): SiteAdminJwtPayload {
    if (payload.type !== 'siteadmin') {
      throw new UnauthorizedException(
        'Invalid token type for SiteAdmin access',
      );
    }
    if (!payload.siteadmin_id) {
      throw new UnauthorizedException('Malformed SiteAdmin token');
    }
    return payload;
  }
}
