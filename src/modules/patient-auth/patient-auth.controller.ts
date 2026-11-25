import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { PatientAuthService } from './patient-auth.service';
import { PatientLoginDto } from './dto/patient-login.dto';
import { SelectBusinessDto } from './dto/select-business.dto';
import { SwitchBusinessDto } from './dto/switch-business.dto';
import { PatientRefreshTokenDto } from './dto/patient-refresh-token.dto';
import { ChangePatientPasswordDto } from './dto/change-patient-password.dto';
import { PatientJwtGuard } from './guards/patient-jwt.guard';
import { CurrentPatient } from './decorators/current-patient.decorator';
import { AllowTempPassword } from './decorators/allow-temp-password.decorator';
import { Public } from '../auth/decorators/public.decorator';
import type { PatientJwtPayload } from './types/patient-jwt-payload.type';

/**
 * Patient-portal authentication — an isolated third auth surface. The whole
 * controller is `@Public()` so the global business `JwtAuthGuard` skips it;
 * `login`/`select-business`/`refresh` are fully public, while the session routes
 * are protected by `PatientJwtGuard` (the `'jwt-patient'` strategy). A patient
 * token is, by construction, rejected on every business/SiteAdmin route.
 */
@Public()
@Controller('patient-portal/auth')
export class PatientAuthController {
  constructor(private readonly patientAuthService: PatientAuthService) {}

  /**
   * Step 1 — log in with mobile/email + password. Returns a short-lived
   * bootstrap token and the businesses this patient can enter.
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: PatientLoginDto, @Req() req: Request) {
    return this.patientAuthService.login(dto, this.clientIp(req));
  }

  /**
   * Step 2 — exchange the bootstrap token + a chosen business for a tenant-scoped
   * access (15m) + refresh (30d) pair.
   */
  @Post('select-business')
  @HttpCode(HttpStatus.OK)
  selectBusiness(@Body() dto: SelectBusinessDto, @Req() req: Request) {
    return this.patientAuthService.selectBusiness(dto, this.clientIp(req));
  }

  /** Rotate a patient refresh token for a new access + refresh pair. */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: PatientRefreshTokenDto, @Req() req: Request) {
    return this.patientAuthService.refresh(
      dto.refreshToken,
      this.clientIp(req),
    );
  }

  /**
   * Switch the session to another of the patient's businesses without a
   * re-login. Returns a fresh access + refresh pair scoped to the target tenant.
   * Blocked on a temp-password session (not `@AllowTempPassword`).
   */
  @Post('switch-business')
  @UseGuards(PatientJwtGuard)
  @HttpCode(HttpStatus.OK)
  switchBusiness(
    @CurrentPatient('person_id') personId: string,
    @Body() dto: SwitchBusinessDto,
    @Req() req: Request,
  ) {
    return this.patientAuthService.switchBusiness(
      personId,
      dto,
      this.clientIp(req),
    );
  }

  /**
   * Change the patient's password. Reachable on a temp-password session
   * (`@AllowTempPassword`) — this is how a patient clears the staff-issued
   * temp password on first login.
   */
  @Post('change-password')
  @UseGuards(PatientJwtGuard)
  @AllowTempPassword()
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @CurrentPatient('person_id') personId: string,
    @Body() dto: ChangePatientPasswordDto,
  ) {
    await this.patientAuthService.changePassword(personId, dto);
    return { message: 'Password changed successfully' };
  }

  /** Log out of the patient portal (revokes the patient refresh tokens). */
  @Post('logout')
  @UseGuards(PatientJwtGuard)
  @HttpCode(HttpStatus.OK)
  async logout(@CurrentPatient('person_id') personId: string) {
    await this.patientAuthService.logout(personId);
    return { message: 'Logged out successfully' };
  }

  /** Current patient-portal session info from the token. */
  @Get('me')
  @UseGuards(PatientJwtGuard)
  me(@CurrentPatient() patient: PatientJwtPayload) {
    return {
      person_id: patient.person_id,
      patient_id: patient.patient_id,
      tenant_id: patient.tenant_id,
      active_branch_id: patient.active_branch_id,
      platform_mrn: patient.platform_mrn,
      is_patient_context: patient.is_patient_context,
      must_change_password: patient.must_change_password,
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
