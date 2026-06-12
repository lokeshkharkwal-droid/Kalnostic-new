import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { BranchType } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { PasswordService } from '../security/password.service';
import { UsersService } from '../users/users.service';
import { TenantService } from '../tenant/tenant.service';
import { BranchService } from '../branch/branch.service';
import {
  PROFILE_LABELS,
  ProfileKey,
} from '../permissions/constants/profile-registry.constant';
import { JwtPayload, JwtProfileEntry } from './types/jwt-payload.type';
import { LoginDto } from './dto/login.dto';
import { SwitchProfileDto } from './dto/switch-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import {
  AccountInactiveException,
  AccountLockedException,
  InvalidCredentialsException,
  InvalidPasswordException,
  InvalidRefreshTokenException,
  ProfileSwitchDeniedException,
} from './exceptions/auth.exceptions';

const MAX_FAILED_ATTEMPTS = 10;
const LOCK_DURATION_MINUTES = 15;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly accessTtl: JwtSignOptions['expiresIn'];
  private readonly refreshDays: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly passwordService: PasswordService,
    private readonly usersService: UsersService,
    private readonly tenantService: TenantService,
    private readonly branchService: BranchService,
    private readonly config: ConfigService,
  ) {
    this.accessTtl = this.config.get<string>(
      'JWT_ACCESS_TTL',
      '15m',
    ) as JwtSignOptions['expiresIn'];
    this.refreshDays = this.config.get<number>('JWT_REFRESH_TTL_DAYS', 30);
  }

  /**
   * Authenticate with identifier (phone/email/system_username) + password.
   * Enforces lockout (10 attempts → 15 min) and issues an access+refresh pair.
   * @param dto credentials + optional tenant slug
   * @param clientIp client IP (audit)
   */
  async login(
    dto: LoginDto,
    clientIp: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const credentials = await this.prisma.personCredentials.findFirst({
      where: {
        OR: [
          { phone: dto.identifier },
          { email: dto.identifier },
          { systemUsername: dto.identifier },
        ],
        deletedAt: null,
      },
    });
    if (!credentials) {
      throw new InvalidCredentialsException();
    }
    if (credentials.lockedUntil && credentials.lockedUntil > new Date()) {
      throw new AccountLockedException(credentials.lockedUntil);
    }

    const person = await this.prisma.person.findFirst({
      where: { id: credentials.personId, deletedAt: null },
    });
    if (!person || !person.isActive) {
      throw new AccountInactiveException(credentials.personId);
    }

    const passwordMatch = await this.passwordService.verify(
      dto.password,
      credentials.passwordHash,
    );
    if (!passwordMatch) {
      const updated = await this.prisma.personCredentials.update({
        where: { id: credentials.id },
        data: { failedAttempts: { increment: 1 } },
        select: { failedAttempts: true },
      });
      if (updated.failedAttempts >= MAX_FAILED_ATTEMPTS) {
        const lockedUntil = new Date(
          Date.now() + LOCK_DURATION_MINUTES * 60_000,
        );
        await this.prisma.personCredentials.update({
          where: { id: credentials.id },
          data: { lockedUntil },
        });
        throw new AccountLockedException(lockedUntil);
      }
      throw new InvalidCredentialsException();
    }

    await this.prisma.personCredentials.update({
      where: { id: credentials.id },
      data: {
        failedAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        lastLoginIp: clientIp,
      },
    });

    let tenantId: string;
    if (dto.tenantSlug) {
      const tenant = await this.tenantService.findBySlug(dto.tenantSlug);
      tenantId = tenant.id;
    } else {
      tenantId = person.ownerTenantId ?? '';
    }

    this.logger.log(`Login successful: person ${person.id} from ${clientIp}`);
    return this.issueTokens(person.id, tenantId, null, null, clientIp);
  }

  /**
   * Rotate a refresh token: validate, mark the old one used, issue a new pair
   * with the same context.
   * @param refreshTokenValue raw refresh token from the client
   * @param clientIp client IP (audit)
   */
  async refresh(
    refreshTokenValue: string,
    clientIp: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const tokenHash = this.hashToken(refreshTokenValue);
    const stored = await this.prisma.refreshToken.findFirst({
      where: { tokenHash, deletedAt: null },
    });
    if (
      !stored ||
      stored.isUsed ||
      stored.isRevoked ||
      stored.expiresAt < new Date()
    ) {
      throw new InvalidRefreshTokenException();
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { isUsed: true },
    });

    const tenantId = await this.getTenantForPerson(stored.personId);
    return this.issueTokens(
      stored.personId,
      tenantId,
      stored.branchId,
      stored.profileKey,
      clientIp,
    );
  }

  /**
   * Switch the active profile context (issues a new access token only).
   * @param personId logged-in person
   * @param tenantId current tenant context
   * @param dto target branch + profile
   */
  async switchProfile(
    personId: string,
    tenantId: string,
    dto: SwitchProfileDto,
  ): Promise<{ accessToken: string }> {
    const branchId = dto.branchId ?? null;
    const assignment = await this.prisma.userBranchProfile.findFirst({
      where: {
        tenantId,
        personId,
        branchId,
        profileKey: dto.profileKey,
        isActive: true,
        deletedAt: null,
      },
    });
    if (!assignment) {
      throw new ProfileSwitchDeniedException(
        branchId ?? 'tenant',
        dto.profileKey,
      );
    }
    const payload = await this.buildJwtPayload(
      personId,
      tenantId,
      branchId,
      dto.profileKey,
    );
    const accessToken = this.jwtService.sign(payload, {
      expiresIn: this.accessTtl,
    });
    return { accessToken };
  }

  /**
   * Change the caller's password after verifying the current one.
   * @param personId the person changing their password
   * @param dto current + new password
   */
  async changePassword(
    personId: string,
    dto: ChangePasswordDto,
  ): Promise<void> {
    const credentials = await this.prisma.personCredentials.findUnique({
      where: { personId },
    });
    if (!credentials) {
      throw new InvalidCredentialsException();
    }
    const currentMatch = await this.passwordService.verify(
      dto.currentPassword,
      credentials.passwordHash,
    );
    if (!currentMatch) {
      throw new InvalidCredentialsException();
    }
    const policyError = this.passwordService.validate(dto.newPassword);
    if (policyError) {
      throw new InvalidPasswordException(policyError);
    }
    const newHash = await this.passwordService.hash(dto.newPassword);
    await this.prisma.personCredentials.update({
      where: { personId },
      data: { passwordHash: newHash, isTempPassword: false },
    });
    this.logger.log(`Password changed for person ${personId}`);
  }

  /**
   * Revoke all of a person's refresh tokens (logout from all devices).
   * @param personId person to log out
   */
  async revokeAllTokens(personId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { personId, isRevoked: false },
      data: { isRevoked: true },
    });
    this.logger.log(`All tokens revoked for person ${personId}`);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Build the complete JWT payload, embedding all branch+profile assignments
   * for the switcher UI (CLAUDE.md §5.1).
   */
  private async buildJwtPayload(
    personId: string,
    tenantId: string,
    activeBranchId: string | null,
    activeProfile: string | null,
  ): Promise<JwtPayload> {
    const [person, allProfiles] = await Promise.all([
      this.prisma.person.findFirst({
        where: { id: personId, deletedAt: null },
      }),
      this.usersService.getPersonProfiles(personId),
    ]);

    // Resolve tenant context, with a fallback when ownerTenantId has no profiles.
    let resolvedTenantId = tenantId;
    const matchesOwner = allProfiles.filter((p) => p.tenantId === tenantId);
    if (matchesOwner.length === 0 && allProfiles.length > 0) {
      const uniqueTenants = [...new Set(allProfiles.map((p) => p.tenantId))];
      const [singleTenant] = uniqueTenants;
      if (uniqueTenants.length === 1 && singleTenant) {
        resolvedTenantId = singleTenant;
      }
    }

    const profileEntries: JwtProfileEntry[] = await Promise.all(
      allProfiles
        .filter((p) => p.tenantId === resolvedTenantId)
        .map(async (p) => {
          const label =
            PROFILE_LABELS[p.profileKey as ProfileKey] ?? p.profileKey;
          if (!p.branchId) {
            return {
              branch_id: null,
              branch_name: null,
              branch_type: null,
              profile_key: p.profileKey,
              profile_label: label,
              is_default: p.isDefault,
            };
          }
          const branch = await this.safeFindBranch(
            p.branchId,
            resolvedTenantId,
          );
          return {
            branch_id: p.branchId,
            branch_name: branch?.name ?? null,
            branch_type: branch?.branchType ?? null,
            profile_key: p.profileKey,
            profile_label: label,
            is_default: p.isDefault,
          };
        }),
    );

    let effectiveBranchId = activeBranchId;
    let effectiveProfileKey = activeProfile;
    let effectiveBranchType: BranchType | null = null;

    if (
      !effectiveBranchId &&
      !effectiveProfileKey &&
      profileEntries.length > 0
    ) {
      const def = profileEntries.find((p) => p.is_default) ?? profileEntries[0];
      if (def) {
        effectiveBranchId = def.branch_id;
        effectiveProfileKey = def.profile_key;
        effectiveBranchType = def.branch_type;
      }
    } else if (effectiveProfileKey) {
      const active = profileEntries.find(
        (p) =>
          p.branch_id === effectiveBranchId &&
          p.profile_key === effectiveProfileKey,
      );
      effectiveBranchType = active?.branch_type ?? null;
    }

    return {
      person_id: personId,
      tenant_id: resolvedTenantId,
      active_branch_id: effectiveBranchId,
      active_branch_type: effectiveBranchType,
      active_profile_key: effectiveProfileKey,
      is_patient_context: false,
      profiles: profileEntries,
      is_patient: person?.isPatient ?? false,
      platform_mrn: person?.platformMrn ?? null,
    };
  }

  /**
   * Issue an access token + refresh token pair (refresh token is random,
   * stored only as a SHA-256 hash).
   */
  private async issueTokens(
    personId: string,
    tenantId: string,
    activeBranchId: string | null,
    activeProfile: string | null,
    clientIp: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const payload = await this.buildJwtPayload(
      personId,
      tenantId,
      activeBranchId,
      activeProfile,
    );
    const accessToken = this.jwtService.sign(payload, {
      expiresIn: this.accessTtl,
    });

    const rawRefreshToken = randomBytes(64).toString('hex');
    const tokenHash = this.hashToken(rawRefreshToken);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + this.refreshDays);

    await this.prisma.refreshToken.create({
      data: {
        personId,
        tokenHash,
        branchId: payload.active_branch_id,
        profileKey: payload.active_profile_key,
        issuedToIp: clientIp,
        expiresAt,
        isUsed: false,
        isRevoked: false,
      },
    });

    return { accessToken, refreshToken: rawRefreshToken };
  }

  /** SHA-256 hash a token for storage (raw tokens are never stored). */
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** Active tenant for a person, falling back to their ownerTenantId. */
  private async getTenantForPerson(personId: string): Promise<string> {
    const person = await this.prisma.person.findFirst({
      where: { id: personId, deletedAt: null },
      select: { ownerTenantId: true },
    });
    return person?.ownerTenantId ?? '';
  }

  /** Look up a branch without throwing (returns null if not found). */
  private async safeFindBranch(branchId: string, tenantId: string) {
    try {
      return await this.branchService.findById(branchId, tenantId);
    } catch {
      return null;
    }
  }
}
