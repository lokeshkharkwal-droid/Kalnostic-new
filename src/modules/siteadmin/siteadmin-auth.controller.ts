import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { SiteAdminService } from './siteadmin.service';
import { SiteAdminLoginDto } from './dto/siteadmin-login.dto';
import { Public } from '../auth/decorators/public.decorator';

/**
 * SiteAdmin authentication — separate from business auth. `@Public()` bypasses
 * the global business `JwtAuthGuard`; the issued token is validated by
 * `SiteAdminPermissionGuard` on protected siteadmin routes.
 */
@Public()
@Controller('siteadmin/auth')
export class SiteAdminAuthController {
  constructor(private readonly siteAdminService: SiteAdminService) {}

  /**
   * Log in with email + password. Returns a siteadmin-typed JWT (8h).
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: SiteAdminLoginDto, @Req() req: Request) {
    const forwarded = (req.headers['x-forwarded-for'] as string | undefined)
      ?.split(',')[0]
      ?.trim();
    const clientIp = forwarded ?? req.socket.remoteAddress ?? 'unknown';
    return this.siteAdminService.login(dto, clientIp);
  }
}
