import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { SwitchProfileDto } from './dto/switch-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import type { JwtPayload } from './types/jwt-payload.type';

/**
 * Business auth endpoints. `login` and `refresh` are public; the rest require
 * a valid business JWT (enforced by the global `JwtAuthGuard`).
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Log in with identifier + password. Returns access (15m) + refresh (30d).
   */
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(dto, this.clientIp(req));
  }

  /**
   * Exchange a refresh token for a new access + refresh pair (rotation).
   */
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshTokenDto, @Req() req: Request) {
    return this.authService.refresh(dto.refreshToken, this.clientIp(req));
  }

  /**
   * Switch the active branch/profile context. Returns a fresh access + refresh
   * pair capturing the new context (the refresh token is rotated so a later
   * refresh keeps the switched branch rather than reverting).
   */
  @Post('switch-profile')
  @HttpCode(HttpStatus.OK)
  switchProfile(
    @CurrentUser() user: JwtPayload,
    @Body() dto: SwitchProfileDto,
    @Req() req: Request,
  ) {
    return this.authService.switchProfile(
      user.person_id,
      user.tenant_id,
      dto,
      this.clientIp(req),
    );
  }

  /**
   * Change the caller's password (requires the current password).
   */
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @CurrentUser('person_id') personId: string,
    @Body() dto: ChangePasswordDto,
  ) {
    await this.authService.changePassword(personId, dto);
    return { message: 'Password changed successfully' };
  }

  /**
   * Log out from all devices (revokes all refresh tokens).
   */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@CurrentUser('person_id') personId: string) {
    await this.authService.revokeAllTokens(personId);
    return { message: 'Logged out successfully' };
  }

  /**
   * Return the current session info from the JWT.
   */
  @Get('me')
  me(@CurrentUser() user: JwtPayload) {
    return {
      person_id: user.person_id,
      tenant_id: user.tenant_id,
      active_branch_id: user.active_branch_id,
      active_profile_key: user.active_profile_key,
      is_patient_context: user.is_patient_context,
      platform_mrn: user.platform_mrn,
      profiles: user.profiles,
    };
  }

  /** Extract the client IP from forwarding headers or the socket. */
  private clientIp(req: Request): string {
    const forwarded = (req.headers['x-forwarded-for'] as string | undefined)
      ?.split(',')[0]
      ?.trim();
    return forwarded ?? req.socket.remoteAddress ?? 'unknown';
  }
}
