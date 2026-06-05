import { Injectable, Logger } from '@nestjs/common';
import { Prisma, SubscriptionStatus, Tenant } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { PasswordService } from '../security/password.service';
import { InternalException } from '../../common/exceptions/kaltros.exception';
import {
  PersonEmailTakenException,
  PersonPhoneTakenException,
} from '../users/exceptions/users.exceptions';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { TenantSettings } from './entities/tenant.entity';
import {
  TenantNotFoundException,
  TenantSlugTakenException,
} from './exceptions/tenant.exceptions';

/** Platform defaults applied to every new tenant's `settings`. */
const DEFAULT_SETTINGS: TenantSettings = {
  timezone: 'Asia/Kolkata',
  currency: 'INR',
  date_format: 'DD/MM/YYYY',
  language: 'en',
};

/** Metadata about a tenant's business-admin account. */
export interface BusinessAdminInfo {
  personId: string;
  firstName: string;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  platformMrn: string;
  isActive: boolean;
  isTempPassword: boolean;
  lastLoginAt: Date | null;
}

@Injectable()
export class TenantService {
  private readonly logger = new Logger(TenantService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
  ) {}

  /**
   * Create a tenant and its first `business_admin` user atomically.
   *
   * Steps: validate slug + admin phone/email uniqueness, then in one
   * transaction create the tenant, the admin person, their credentials (temp
   * password), and a tenant-level `business_admin` profile (branch_id = NULL).
   * Returns the temp password once so SiteAdmin can share it.
   *
   * @param dto tenant + admin data
   * @param createdBy SiteAdmin user id
   */
  async create(
    dto: CreateTenantDto,
    createdBy: string,
  ): Promise<{ tenant: Tenant; adminPhone: string; tempPassword: string }> {
    const slugTaken = await this.prisma.tenant.findFirst({
      where: { slug: dto.slug, deletedAt: null },
      select: { id: true },
    });
    if (slugTaken) {
      throw new TenantSlugTakenException(dto.slug);
    }

    const phoneTaken = await this.prisma.person.findFirst({
      where: { phone: dto.adminPhone, deletedAt: null },
      select: { id: true },
    });
    if (phoneTaken) {
      throw new PersonPhoneTakenException(dto.adminPhone);
    }

    if (dto.adminEmail) {
      const emailTaken = await this.prisma.person.findFirst({
        where: { email: dto.adminEmail, deletedAt: null },
        select: { id: true },
      });
      if (emailTaken) {
        throw new PersonEmailTakenException(dto.adminEmail);
      }
    }

    const settings: TenantSettings = {
      ...DEFAULT_SETTINGS,
      ...(dto.settings ?? {}),
    };
    const tempPassword = this.passwordService.generateTempPassword();
    const passwordHash = await this.passwordService.hash(tempPassword);
    const platformMrn = this.generatePlatformMrn();

    try {
      const tenant = await this.prisma.$transaction(async (tx) => {
        const created = await tx.tenant.create({
          data: {
            name: dto.name,
            slug: dto.slug,
            email: dto.email ?? null,
            phone: dto.phone ?? null,
            address: (dto.address ?? Prisma.JsonNull) as Prisma.InputJsonValue,
            mrnPrefix: dto.mrnPrefix ?? null,
            settings: settings as unknown as Prisma.InputJsonValue,
            subscriptionStatus: SubscriptionStatus.TRIALING,
            isActive: true,
            createdBy,
          },
        });

        const admin = await tx.person.create({
          data: {
            platformMrn,
            firstName: dto.adminFirstName,
            lastName: dto.adminLastName ?? null,
            phone: dto.adminPhone,
            email: dto.adminEmail ?? null,
            ownerTenantId: created.id,
            isPatient: false,
            isStaff: true,
            isActive: true,
          },
        });

        await tx.personCredentials.create({
          data: {
            personId: admin.id,
            phone: dto.adminPhone,
            email: dto.adminEmail ?? null,
            passwordHash,
            isTempPassword: true,
          },
        });

        await tx.userBranchProfile.create({
          data: {
            tenantId: created.id,
            personId: admin.id,
            branchId: null, // tenant-level profile
            profileKey: 'business_admin',
            isDefault: true,
            isActive: true,
            assignedAt: new Date(),
          },
        });

        return created;
      });

      this.logger.log(
        `Tenant created: ${tenant.id} (${tenant.slug}) by SiteAdmin ${createdBy}`,
      );
      return { tenant, adminPhone: dto.adminPhone, tempPassword };
    } catch (error) {
      this.logger.error(
        `Failed to create tenant with slug '${dto.slug}'`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new InternalException('tenant-create', { slug: dto.slug });
    }
  }

  /**
   * Find a tenant by UUID.
   * @throws TenantNotFoundException if missing or soft-deleted
   */
  async findById(id: string): Promise<Tenant> {
    const tenant = await this.prisma.tenant.findFirst({
      where: { id, deletedAt: null },
    });
    if (!tenant) {
      throw new TenantNotFoundException(id);
    }
    return tenant;
  }

  /**
   * Find a tenant by subdomain slug (used during login to resolve context).
   * @throws TenantNotFoundException if missing
   */
  async findBySlug(slug: string): Promise<Tenant> {
    const tenant = await this.prisma.tenant.findFirst({
      where: { slug, deletedAt: null },
    });
    if (!tenant) {
      throw new TenantNotFoundException(slug);
    }
    return tenant;
  }

  /**
   * Find a tenant by custom domain (used by domain-routing middleware).
   * @returns the tenant or null
   */
  async findByCustomDomain(domain: string): Promise<Tenant | null> {
    return this.prisma.tenant.findFirst({
      where: { customDomain: domain, deletedAt: null },
    });
  }

  /**
   * List all tenants (SiteAdmin only), offset-paginated.
   * @param page 1-based page (default 1)
   * @param limit page size (default 20)
   */
  async findAll(page = 1, limit = 20) {
    const where = { deletedAt: null };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.tenant.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.tenant.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  /**
   * Update a tenant's editable fields. Slug is immutable; `settings` is
   * deep-merged so partial updates don't wipe existing values.
   * @param id tenant id
   * @param dto fields to update
   * @param updatedBy actor (for logs)
   */
  async update(
    id: string,
    dto: UpdateTenantDto,
    updatedBy: string,
  ): Promise<Tenant> {
    const tenant = await this.findById(id);

    const data: Prisma.TenantUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.email !== undefined) data.email = dto.email ?? null;
    if (dto.phone !== undefined) data.phone = dto.phone ?? null;
    if (dto.address !== undefined) {
      data.address = (dto.address ?? Prisma.JsonNull) as Prisma.InputJsonValue;
    }
    if (dto.mrnPrefix !== undefined) data.mrnPrefix = dto.mrnPrefix ?? null;
    if (dto.settings !== undefined) {
      const merged = {
        ...((tenant.settings as unknown as TenantSettings) ?? DEFAULT_SETTINGS),
        ...dto.settings,
      };
      data.settings = merged;
    }

    const updated = await this.prisma.tenant.update({ where: { id }, data });
    this.logger.log(`Tenant updated: ${id} by ${updatedBy}`);
    return updated;
  }

  /**
   * Atomically generate the next per-tenant MRN, e.g. "CD-00842".
   * @param tenantId tenant whose counter to increment
   * @param prefix overrides the tenant's stored prefix
   */
  async generateNextMrn(tenantId: string, prefix?: string): Promise<string> {
    const tenant = await this.findById(tenantId);
    const updated = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { mrnCounter: { increment: 1 } },
      select: { mrnCounter: true },
    });
    const effectivePrefix = prefix ?? tenant.mrnPrefix ?? 'MRN';
    return `${effectivePrefix}-${String(updated.mrnCounter).padStart(5, '0')}`;
  }

  /**
   * Get the tenant's business-admin account details + credential metadata.
   * @param tenantId tenant id
   * @returns admin info, or null if none exists
   */
  async getBusinessAdmin(tenantId: string): Promise<BusinessAdminInfo | null> {
    const profile = await this.prisma.userBranchProfile.findFirst({
      where: {
        tenantId,
        profileKey: 'business_admin',
        branchId: null,
        isActive: true,
        deletedAt: null,
      },
    });
    if (!profile) {
      return null;
    }

    const person = await this.prisma.person.findFirst({
      where: { id: profile.personId, deletedAt: null },
    });
    if (!person) {
      return null;
    }

    const credentials = await this.prisma.personCredentials.findUnique({
      where: { personId: person.id },
    });

    return {
      personId: person.id,
      firstName: person.firstName,
      lastName: person.lastName,
      phone: person.phone,
      email: person.email,
      platformMrn: person.platformMrn,
      isActive: person.isActive,
      isTempPassword: credentials?.isTempPassword ?? true,
      lastLoginAt: credentials?.lastLoginAt ?? null,
    };
  }

  /**
   * Reset the business admin's password; returns a fresh temp password once.
   * @param tenantId tenant id
   * @param requestedBy SiteAdmin actor
   */
  async resetBusinessAdminPassword(
    tenantId: string,
    requestedBy: string,
  ): Promise<{ adminPhone: string; tempPassword: string }> {
    const admin = await this.getBusinessAdmin(tenantId);
    if (!admin) {
      throw new InternalException('tenant-reset-password-no-admin', {
        tenantId,
      });
    }

    const tempPassword = this.passwordService.generateTempPassword();
    const passwordHash = await this.passwordService.hash(tempPassword);

    await this.prisma.personCredentials.update({
      where: { personId: admin.personId },
      data: {
        passwordHash,
        isTempPassword: true,
        failedAttempts: 0,
        lockedUntil: null,
      },
    });

    this.logger.log(
      `Business admin password reset for tenant ${tenantId} by SiteAdmin ${requestedBy}`,
    );
    return { adminPhone: admin.phone ?? '', tempPassword };
  }

  /**
   * Generate a globally-unique platform MRN: `KAL-YYYYMMDD-XXXXXXXX`.
   * High-entropy random suffix makes collisions negligible.
   */
  private generatePlatformMrn(): string {
    const now = new Date();
    const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const rand = randomBytes(4).toString('hex').toUpperCase();
    return `KAL-${ymd}-${rand}`;
  }
}
