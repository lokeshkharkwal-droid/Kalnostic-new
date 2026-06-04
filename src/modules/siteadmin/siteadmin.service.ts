import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { SiteAdminRole, SiteAdminUser } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PasswordService } from '../security/password.service';
import { SiteAdminJwtPayload } from './types/siteadmin-jwt.type';
import { SiteAdminLoginDto } from './dto/siteadmin-login.dto';
import { CreateSiteAdminDto } from './dto/create-siteadmin.dto';
import {
  SiteAdminAccountLockedException,
  SiteAdminCannotModifySuperOwnerException,
  SiteAdminEmailTakenException,
  SiteAdminInvalidCredentialsException,
  SiteAdminNotFoundException,
} from './exceptions/siteadmin.exceptions';
import { InvalidPasswordException } from '../auth/exceptions/auth.exceptions';

const MAX_FAILED_ATTEMPTS = 10;
const LOCK_DURATION_MINUTES = 15;

@Injectable()
export class SiteAdminService {
  private readonly logger = new Logger(SiteAdminService.name);
  private readonly tokenTtl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {
    this.tokenTtl = this.config.get<string>('SITEADMIN_TOKEN_TTL', '8h');
  }

  /**
   * Authenticate a SiteAdmin (email + password). Issues a `type: 'siteadmin'`
   * token (8h). Same lockout policy as business users.
   * @param dto login credentials
   * @param clientIp client IP (audit)
   */
  async login(dto: SiteAdminLoginDto, clientIp: string): Promise<{ accessToken: string }> {
    const admin = await this.prisma.siteAdminUser.findFirst({
      where: { email: dto.email, deletedAt: null },
    });
    if (!admin || !admin.isActive) {
      throw new SiteAdminInvalidCredentialsException();
    }
    if (admin.lockedUntil && admin.lockedUntil > new Date()) {
      throw new SiteAdminAccountLockedException(admin.lockedUntil);
    }

    const passwordMatch = await this.passwordService.verify(
      dto.password,
      admin.passwordHash,
    );
    if (!passwordMatch) {
      const updated = await this.prisma.siteAdminUser.update({
        where: { id: admin.id },
        data: { failedAttempts: { increment: 1 } },
        select: { failedAttempts: true },
      });
      if (updated.failedAttempts >= MAX_FAILED_ATTEMPTS) {
        const lockedUntil = new Date(Date.now() + LOCK_DURATION_MINUTES * 60_000);
        await this.prisma.siteAdminUser.update({
          where: { id: admin.id },
          data: { lockedUntil },
        });
        throw new SiteAdminAccountLockedException(lockedUntil);
      }
      throw new SiteAdminInvalidCredentialsException();
    }

    await this.prisma.siteAdminUser.update({
      where: { id: admin.id },
      data: {
        failedAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        lastLoginIp: clientIp,
      },
    });

    const payload: SiteAdminJwtPayload = {
      type: 'siteadmin',
      siteadmin_id: admin.id,
      email: admin.email,
      role: admin.role,
    };
    const accessToken = this.jwtService.sign(payload, { expiresIn: this.tokenTtl });
    this.logger.log(`SiteAdmin login: ${admin.email} (${admin.role}) from ${clientIp}`);
    return { accessToken };
  }

  /**
   * Create a SiteAdmin sub-account (super_owner only, enforced by the guard).
   * Cannot create another super_owner.
   * @param dto new admin details
   * @param createdBy super_owner's id
   */
  async create(dto: CreateSiteAdminDto, createdBy: string): Promise<SiteAdminUser> {
    if (dto.role === SiteAdminRole.SUPER_OWNER) {
      throw new SiteAdminCannotModifySuperOwnerException();
    }
    const emailTaken = await this.prisma.siteAdminUser.findFirst({
      where: { email: dto.email, deletedAt: null },
      select: { id: true },
    });
    if (emailTaken) {
      throw new SiteAdminEmailTakenException(dto.email);
    }
    const policyError = this.passwordService.validate(dto.password);
    if (policyError) {
      throw new InvalidPasswordException(policyError);
    }
    const passwordHash = await this.passwordService.hash(dto.password);
    const admin = await this.prisma.siteAdminUser.create({
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName ?? null,
        email: dto.email,
        passwordHash,
        role: dto.role,
        isActive: true,
        createdBy,
      },
    });
    this.logger.log(`SiteAdmin created: ${admin.email} (${admin.role}) by ${createdBy}`);
    return admin;
  }

  /**
   * List all SiteAdmin accounts (super_owner only).
   */
  async findAll(): Promise<SiteAdminUser[]> {
    return this.prisma.siteAdminUser.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Change any SiteAdmin's password (super_owner only).
   * @param id target siteadmin id
   * @param newPassword plaintext new password (validated + hashed here)
   * @param requestedBy super_owner's id
   */
  async changePassword(
    id: string,
    newPassword: string,
    requestedBy: string,
  ): Promise<void> {
    const admin = await this.prisma.siteAdminUser.findFirst({
      where: { id, deletedAt: null },
    });
    if (!admin) {
      throw new SiteAdminNotFoundException(id);
    }
    const policyError = this.passwordService.validate(newPassword);
    if (policyError) {
      throw new InvalidPasswordException(policyError);
    }
    const passwordHash = await this.passwordService.hash(newPassword);
    await this.prisma.siteAdminUser.update({ where: { id }, data: { passwordHash } });
    this.logger.log(`SiteAdmin password changed: ${admin.email} by ${requestedBy}`);
  }

  /**
   * Deactivate a SiteAdmin account (super_owner cannot be deactivated).
   * @param id target siteadmin id
   * @param requestedBy actor id
   */
  async deactivate(id: string, requestedBy: string): Promise<void> {
    const admin = await this.prisma.siteAdminUser.findFirst({
      where: { id, deletedAt: null },
    });
    if (!admin) {
      throw new SiteAdminNotFoundException(id);
    }
    if (admin.role === SiteAdminRole.SUPER_OWNER) {
      throw new SiteAdminCannotModifySuperOwnerException();
    }
    await this.prisma.siteAdminUser.update({ where: { id }, data: { isActive: false } });
    this.logger.log(`SiteAdmin deactivated: ${admin.email} by ${requestedBy}`);
  }
}
