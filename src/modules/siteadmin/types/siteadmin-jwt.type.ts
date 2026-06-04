import { Request } from 'express';
import { SiteAdminRole } from '@prisma/client';

/**
 * SiteAdmin JWT payload (CLAUDE.md §5.2 — preserve exactly). Completely
 * separate from the business `JwtPayload`. The `type: 'siteadmin'`
 * discriminator stops a siteadmin token being used on business routes and
 * vice-versa. Issued by `POST /siteadmin/auth/login`; 8h lifetime.
 */
export interface SiteAdminJwtPayload {
  /** Discriminator — must be `'siteadmin'`. */
  type: 'siteadmin';
  /** SiteAdmin user UUID. */
  siteadmin_id: string;
  /** Email (display + audit). */
  email: string;
  /** Role determines available permissions. */
  role: SiteAdminRole;
  iat?: number;
  exp?: number;
}

/** Express request after siteadmin auth — guard stores payload on `siteadmin`. */
export interface AuthenticatedSiteAdminRequest extends Request {
  siteadmin: SiteAdminJwtPayload;
}
