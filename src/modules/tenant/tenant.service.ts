import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  Prisma,
  StaffStatus,
  SubscriptionStatus,
  Tenant,
  TenantConfiguration,
  TenantSetting,
  UserType,
} from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { PasswordService } from '../security/password.service';
import { AuthRoleService } from '../auth-role/auth-role.service';
import { BranchService } from '../branch/branch.service';
import { CountryService } from '../location/country.service';
import { StateService } from '../location/state.service';
import { CityService } from '../location/city.service';
import { AreaService } from '../location/area.service';
import { LocationHierarchyMismatchException } from '../location/exceptions/location.exceptions';
import {
  InternalException,
  ValidationException,
} from '../../common/exceptions/kaltros.exception';
import {
  PersonEmailTakenException,
  PersonPhoneTakenException,
} from '../users/exceptions/users.exceptions';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { UpdateTenantConfigurationDto } from './dto/update-tenant-configuration.dto';
import { UpdateTenantSettingsDto } from './dto/update-tenant-settings.dto';
import { ListTenantsQueryDto } from './dto/list-tenants-query.dto';
import { BranchQueryDto } from '../branch/dto/branch-query.dto';
import { TenantSettings } from './entities/tenant.entity';
import { SUPPORTED_TIMEZONES } from './dto/tenant-settings.dto';
import {
  TenantCustomDomainTakenException,
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
    private readonly authRoleService: AuthRoleService,
    private readonly branchService: BranchService,
    private readonly countryService: CountryService,
    private readonly stateService: StateService,
    private readonly cityService: CityService,
    private readonly areaService: AreaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Validate whichever location ids were supplied, ensuring each exists (and is
   * not soft-deleted) and that the chain stays consistent — an area's
   * city/state/country must match the supplied ids, a city's state/country must
   * match, and a state's country must match. Any subset of the four ids is
   * allowed (the form cascades top-down), so only the provided links are checked.
   * @throws Country/State/City/AreaNotFoundException if an id is unknown
   * @throws LocationHierarchyMismatchException if the links are inconsistent
   */
  private async assertLocationHierarchy(input: {
    countryId?: string;
    stateId?: string;
    cityId?: string;
    areaId?: string;
  }): Promise<void> {
    const { countryId, stateId, cityId, areaId } = input;

    if (countryId) await this.countryService.findById(countryId);
    if (stateId) {
      const state = await this.stateService.findById(stateId);
      if (countryId && state.countryId !== countryId) {
        throw new LocationHierarchyMismatchException(
          "the state's country must match the supplied country",
          { stateId, countryId, stateCountryId: state.countryId },
        );
      }
    }
    if (cityId) {
      const city = await this.cityService.findById(cityId);
      if (stateId && city.stateId !== stateId) {
        throw new LocationHierarchyMismatchException(
          "the city's state must match the supplied state",
          { cityId, stateId, cityStateId: city.stateId },
        );
      }
      if (countryId && city.countryId !== countryId) {
        throw new LocationHierarchyMismatchException(
          "the city's country must match the supplied country",
          { cityId, countryId, cityCountryId: city.countryId },
        );
      }
    }
    if (areaId) {
      const area = await this.areaService.findById(areaId);
      if (cityId && area.cityId !== cityId) {
        throw new LocationHierarchyMismatchException(
          "the area's city must match the supplied city",
          { areaId, cityId, areaCityId: area.cityId },
        );
      }
      if (stateId && area.stateId !== stateId) {
        throw new LocationHierarchyMismatchException(
          "the area's state must match the supplied state",
          { areaId, stateId, areaStateId: area.stateId },
        );
      }
      if (countryId && area.countryId !== countryId) {
        throw new LocationHierarchyMismatchException(
          "the area's country must match the supplied country",
          { areaId, countryId, areaCountryId: area.countryId },
        );
      }
    }
  }

  /**
   * Create a tenant and its first `business_admin` user atomically.
   *
   * Steps: validate slug + admin phone/email uniqueness, then in one
   * transaction create the tenant, the admin person, their credentials (using
   * the SiteAdmin-supplied password), and a tenant-level `business_admin`
   * profile (branch_id = NULL). The password is chosen by SiteAdmin, so it is
   * not returned — the caller already knows it.
   *
   * @param dto tenant + admin data (incl. the admin's login password)
   * @param createdBy SiteAdmin user id
   */
  async create(
    dto: CreateTenantDto,
    createdBy: string,
  ): Promise<{ tenant: Tenant; adminPhone: string }> {
    let slug: string;
    if (dto.slug) {
      const slugTaken = await this.prisma.tenant.findFirst({
        where: { slug: dto.slug, deletedAt: null },
        select: { id: true },
      });
      if (slugTaken) {
        throw new TenantSlugTakenException(dto.slug);
      }
      slug = dto.slug;
    } else {
      slug = await this.generateUniqueSlug(dto.name);
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

    await this.assertLocationHierarchy(dto);

    const settings: TenantSettings = {
      ...DEFAULT_SETTINGS,
      ...(dto.settings ?? {}),
    };
    // Defence in depth — the DTO already enforces the policy at the pipe, but
    // re-check here so the invariant holds regardless of the entry point.
    const passwordError = this.passwordService.validate(dto.adminPassword);
    if (passwordError) {
      throw new ValidationException(passwordError, {
        adminPassword: passwordError,
      });
    }
    const passwordHash = await this.passwordService.hash(dto.adminPassword);
    const platformMrn = this.generatePlatformMrn();
    // The seeded global `business_admin` system role the initial admin receives.
    const businessAdminRole =
      await this.authRoleService.getSystemRoleByKey('business_admin');

    try {
      const tenant = await this.prisma.$transaction(async (tx) => {
        const created = await tx.tenant.create({
          data: {
            name: dto.name,
            slug,
            email: dto.email ?? null,
            phone: dto.phone ?? null,
            shortName: dto.shortName ?? null,
            address: (dto.address ?? Prisma.JsonNull) as Prisma.InputJsonValue,
            addressLine: dto.addressLine ?? null,
            pincode: dto.pincode ?? null,
            countryId: dto.countryId ?? null,
            stateId: dto.stateId ?? null,
            cityId: dto.cityId ?? null,
            areaId: dto.areaId ?? null,
            logoUrl: dto.logoUrl ?? null,
            photoUrl: dto.photoUrl ?? null,
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
            middleName: dto.adminMiddleName ?? null,
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
            isTempPassword: false,
          },
        });

        // This raw interactive transaction bypasses the RLS extension (only
        // `withTenant`/per-op calls trigger it), so the GUC must be set
        // explicitly here — `user_branch_profiles` enforces
        // tenant_id = current_tenant_id() and the tenant didn't exist to scope
        // to until `created` above.
        await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${created.id}, true)`;

        await tx.userBranchProfile.create({
          data: {
            tenantId: created.id,
            personId: admin.id,
            branchId: null, // tenant-level profile
            authRoleId: businessAdminRole.id,
            isDefault: true,
            isActive: true,
            assignedAt: new Date(),
          },
        });

        // Register the admin as a tenant staff member so they appear in — and
        // can be managed from — the business Users list (mirrors
        // UsersService.createUser). `isPrimaryAdmin` marks this as the default
        // admin, which can never be deactivated.
        const counted = await tx.tenant.update({
          where: { id: created.id },
          data: { staffCounter: { increment: 1 } },
          select: { staffCounter: true },
        });
        const userCode = `USR-${String(counted.staffCounter).padStart(5, '0')}`;
        await tx.tenantStaffMembership.create({
          data: {
            tenantId: created.id,
            personId: admin.id,
            userCode,
            userType: UserType.INTERNAL,
            authRoleId: businessAdminRole.id,
            status: StaffStatus.ACTIVE,
            isPrimaryAdmin: true,
          },
        });

        return created;
      });

      this.logger.log(
        `Tenant created: ${tenant.id} (${tenant.slug}) by SiteAdmin ${createdBy}`,
      );

      // Fire-and-forget: welcome the business (Email/SMS/WhatsApp). Handled by
      // BusinessEventListener; never blocks tenant creation. Falls back to the
      // admin contact when the business contact fields are empty.
      void this.eventEmitter.emitAsync('business.registration.completed', {
        tenantId: tenant.id,
        businessName: tenant.name,
        email: tenant.email ?? dto.adminEmail ?? null,
        phone: tenant.phone ?? dto.adminPhone ?? null,
        slug: tenant.slug,
        adminName: [dto.adminFirstName, dto.adminLastName]
          .filter(Boolean)
          .join(' ')
          .trim(),
      });

      return { tenant, adminPhone: dto.adminPhone };
    } catch (error) {
      this.logger.error(
        `Failed to create tenant with slug '${slug}'`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new InternalException('tenant-create', { slug });
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
   * Resolve the caller tenant's locale (time zone + currency) for the business
   * frontend to convert UTC timestamps for display. Stored `settings` are merged
   * over `DEFAULT_SETTINGS`, so a legacy tenant without settings still gets a
   * usable value. An unsupported stored time zone is logged and falls back to the
   * platform default (§7 fallback) rather than being returned to the client.
   * @param tenantId caller's tenant (from the business JWT)
   * @returns `{ timezone, currency, dateFormat, language }`
   * @throws TenantNotFoundException if the tenant is missing/soft-deleted
   */
  async getLocale(tenantId: string): Promise<{
    timezone: string;
    currency: string;
    dateFormat: string;
    language: string;
  }> {
    const tenant = await this.findById(tenantId);
    const stored =
      (tenant.settings as unknown as Partial<TenantSettings>) ?? {};
    const merged: TenantSettings = { ...DEFAULT_SETTINGS, ...stored };

    if (!(SUPPORTED_TIMEZONES as readonly string[]).includes(merged.timezone)) {
      this.logger.warn(
        `Tenant ${tenantId} has unsupported timezone '${merged.timezone}', falling back to ${DEFAULT_SETTINGS.timezone}`,
      );
      merged.timezone = DEFAULT_SETTINGS.timezone;
    }

    return {
      timezone: merged.timezone,
      currency: merged.currency,
      dateFormat: merged.date_format,
      language: merged.language,
    };
  }

  /**
   * Fetch a tenant with its resolved location relations (country/state/city/area)
   * for the SiteAdmin detail view, so the frontend can render location labels
   * without extra lookups. Also resolves the `createdBy`/`updatedBy` SiteAdmin
   * ids to display names (`createdByName`/`updatedByName`) for the audit panel.
   * @throws TenantNotFoundException if missing or soft-deleted
   */
  async getDetail(id: string) {
    const tenant = await this.prisma.tenant.findFirst({
      where: { id, deletedAt: null },
      include: {
        country: { select: { id: true, name: true, code: true } },
        state: { select: { id: true, name: true, code: true } },
        city: { select: { id: true, name: true, pinCode: true } },
        area: { select: { id: true, name: true, locality: true } },
      },
    });
    if (!tenant) {
      throw new TenantNotFoundException(id);
    }

    const actorIds = [tenant.createdBy, tenant.updatedBy].filter(
      (v): v is string => !!v,
    );
    const actors = actorIds.length
      ? await this.prisma.siteAdminUser.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, firstName: true, lastName: true },
        })
      : [];
    const nameById = new Map(
      actors.map((a) => [
        a.id,
        [a.firstName, a.lastName].filter(Boolean).join(' '),
      ]),
    );

    return {
      ...tenant,
      createdByName: tenant.createdBy
        ? (nameById.get(tenant.createdBy) ?? null)
        : null,
      updatedByName: tenant.updatedBy
        ? (nameById.get(tenant.updatedBy) ?? null)
        : null,
    };
  }

  /**
   * List a tenant's branches (SiteAdmin cross-tenant read). SiteAdmin requests
   * carry no per-request tenant GUC, so the call to the tenant-scoped branch
   * service runs inside `runWithTenant(tenantId, …)` to establish the RLS
   * context the branch queries rely on (CLAUDE.md §4.7 — SiteAdmin passes
   * `tenantId` explicitly). The tenant is validated first so an unknown id 404s.
   * @param tenantId owning tenant
   * @param query pagination + optional search/status/branchType filters
   * @returns `{ data, total, page, limit }` for the `meta` envelope
   */
  async getBranchesForTenant(tenantId: string, query: BranchQueryDto) {
    await this.findById(tenantId);
    return this.prisma.runWithTenant(tenantId, () =>
      this.branchService.findAllForTenant(tenantId, query.page, query.limit, {
        search: query.search,
        status: query.status,
        branchType: query.branchType,
      }),
    );
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
   * List tenants (SiteAdmin only), offset-paginated with optional filters.
   *
   * @param query pagination (`page`/`limit`) plus optional `search`
   *   (case-insensitive substring on name/slug/email) and `status`
   *   (exact `subscriptionStatus`)
   * @returns `{ data, total, page, limit }` for the `meta` envelope
   */
  async findAll(query: ListTenantsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.TenantWhereInput = { deletedAt: null };
    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (query.status) {
      where.subscriptionStatus = query.status;
    }

    // `tenants` is platform-level (no tenant_id / RLS), so array-form is safe.
    // eslint-disable-next-line no-restricted-syntax -- platform table, not tenant-scoped
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
   * Aggregate business (tenant) counts for the SiteAdmin dashboard. All counts
   * exclude soft-deleted tenants (`deletedAt: null`). The per-status counts map
   * strictly to `SubscriptionStatus` values; `GRACE_PERIOD`/`CANCELLED` tenants
   * contribute to `total` only.
   * @returns counts: `total` (all), `active`, `trial`, `suspended`
   */
  async getDashboardCounts(): Promise<{
    total: number;
    active: number;
    trial: number;
    suspended: number;
  }> {
    const base: Prisma.TenantWhereInput = { deletedAt: null };

    // `tenants` is platform-level (no tenant_id / RLS), so array-form is safe.
    // eslint-disable-next-line no-restricted-syntax -- platform table, not tenant-scoped
    const [total, active, trial, suspended] = await this.prisma.$transaction([
      this.prisma.tenant.count({ where: base }),
      this.prisma.tenant.count({
        where: { ...base, subscriptionStatus: SubscriptionStatus.ACTIVE },
      }),
      this.prisma.tenant.count({
        where: { ...base, subscriptionStatus: SubscriptionStatus.TRIALING },
      }),
      this.prisma.tenant.count({
        where: { ...base, subscriptionStatus: SubscriptionStatus.SUSPENDED },
      }),
    ]);

    return { total, active, trial, suspended };
  }

  /**
   * Change a tenant's subscription status (SiteAdmin suspend / reactivate).
   * Only `subscriptionStatus` is touched — `isActive` is left as-is.
   * @param id tenant id
   * @param status new status (`SUSPENDED` to suspend, `ACTIVE` to reactivate)
   * @param updatedBy SiteAdmin actor id (for logs)
   * @returns the updated tenant
   * @throws TenantNotFoundException if the tenant does not exist
   */
  async setSubscriptionStatus(
    id: string,
    status: SubscriptionStatus,
    updatedBy: string,
  ): Promise<Tenant> {
    const before = await this.findById(id);
    const updated = await this.prisma.tenant.update({
      where: { id },
      data: { subscriptionStatus: status, updatedBy },
    });
    this.logger.log(
      `Tenant subscription status -> ${status}: ${id} by ${updatedBy}`,
    );

    // Fire-and-forget: notify the business (Email/SMS) on the relevant
    // transitions — suspended (any active → SUSPENDED) and reinstated
    // (SUSPENDED → ACTIVE). Other transitions (e.g. TRIALING → ACTIVE) don't
    // notify. Handled by BusinessEventListener; never blocks the status change.
    const payload = {
      tenantId: updated.id,
      businessName: updated.name,
      email: updated.email,
      phone: updated.phone,
    };
    if (
      status === SubscriptionStatus.SUSPENDED &&
      before.subscriptionStatus !== SubscriptionStatus.SUSPENDED
    ) {
      void this.eventEmitter.emitAsync('business.status.suspended', payload);
    } else if (
      status === SubscriptionStatus.ACTIVE &&
      before.subscriptionStatus === SubscriptionStatus.SUSPENDED
    ) {
      void this.eventEmitter.emitAsync('business.status.unsuspended', payload);
    }

    return updated;
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

    await this.assertLocationHierarchy({
      countryId: dto.countryId ?? tenant.countryId ?? undefined,
      stateId: dto.stateId ?? tenant.stateId ?? undefined,
      cityId: dto.cityId ?? tenant.cityId ?? undefined,
      areaId: dto.areaId ?? tenant.areaId ?? undefined,
    });

    const data: Prisma.TenantUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.email !== undefined) data.email = dto.email ?? null;
    if (dto.phone !== undefined) data.phone = dto.phone ?? null;
    if (dto.shortName !== undefined) data.shortName = dto.shortName ?? null;
    if (dto.customDomain !== undefined) {
      const customDomain = dto.customDomain?.trim() || null;
      if (customDomain && customDomain !== tenant.customDomain) {
        const taken = await this.prisma.tenant.findFirst({
          where: { customDomain, deletedAt: null, id: { not: id } },
          select: { id: true },
        });
        if (taken) {
          throw new TenantCustomDomainTakenException(customDomain);
        }
      }
      data.customDomain = customDomain;
    }
    if (dto.address !== undefined) {
      data.address = (dto.address ?? Prisma.JsonNull) as Prisma.InputJsonValue;
    }
    if (dto.addressLine !== undefined) {
      data.addressLine = dto.addressLine ?? null;
    }
    if (dto.pincode !== undefined) data.pincode = dto.pincode ?? null;
    if (dto.countryId !== undefined) {
      data.country = dto.countryId
        ? { connect: { id: dto.countryId } }
        : { disconnect: true };
    }
    if (dto.stateId !== undefined) {
      data.state = dto.stateId
        ? { connect: { id: dto.stateId } }
        : { disconnect: true };
    }
    if (dto.cityId !== undefined) {
      data.city = dto.cityId
        ? { connect: { id: dto.cityId } }
        : { disconnect: true };
    }
    if (dto.areaId !== undefined) {
      data.area = dto.areaId
        ? { connect: { id: dto.areaId } }
        : { disconnect: true };
    }
    if (dto.logoUrl !== undefined) data.logoUrl = dto.logoUrl ?? null;
    if (dto.photoUrl !== undefined) data.photoUrl = dto.photoUrl ?? null;
    if (dto.mrnPrefix !== undefined) data.mrnPrefix = dto.mrnPrefix ?? null;
    if (dto.settings !== undefined) {
      const merged = {
        ...((tenant.settings as unknown as TenantSettings) ?? DEFAULT_SETTINGS),
        ...dto.settings,
      };
      data.settings = merged;
    }
    data.updatedBy = updatedBy;

    const updated = await this.prisma.tenant.update({ where: { id }, data });
    this.logger.log(`Tenant updated: ${id} by ${updatedBy}`);

    // Fire-and-forget: confirm the profile change to the business (Email/SMS).
    void this.eventEmitter.emitAsync('business.details.updated', {
      tenantId: updated.id,
      businessName: updated.name,
      email: updated.email,
      phone: updated.phone,
    });

    return updated;
  }

  /**
   * Get a tenant's Business Configuration, creating a defaults row on first
   * access (theme LIGHT, other fields null) so the SiteAdmin form always has a
   * value to bind. The tenant is validated first so an unknown id 404s.
   * @param id tenant id
   * @throws TenantNotFoundException if the tenant is missing/soft-deleted
   */
  async getConfiguration(id: string): Promise<TenantConfiguration> {
    await this.findById(id);
    return this.prisma.tenantConfiguration.upsert({
      where: { tenantId: id },
      create: { tenantId: id },
      update: {},
    });
  }

  /**
   * Update (upsert) a tenant's Business Configuration. Only supplied fields are
   * patched; the row is created if it doesn't exist yet.
   * @param id tenant id
   * @param dto configuration fields to set
   * @param updatedBy SiteAdmin actor (for logs)
   * @throws TenantNotFoundException if the tenant is missing/soft-deleted
   */
  async updateConfiguration(
    id: string,
    dto: UpdateTenantConfigurationDto,
    updatedBy: string,
  ): Promise<TenantConfiguration> {
    await this.findById(id);
    const config = await this.prisma.tenantConfiguration.upsert({
      where: { tenantId: id },
      create: { tenantId: id, ...dto },
      update: { ...dto },
    });
    this.logger.log(`Tenant configuration updated: ${id} by ${updatedBy}`);
    return config;
  }

  /**
   * Get a tenant's Business Settings, creating a defaults row on first access
   * (all toggles false, commission types EXCLUSIVE). The tenant is validated
   * first so an unknown id 404s.
   * @param id tenant id
   * @throws TenantNotFoundException if the tenant is missing/soft-deleted
   */
  async getSettings(id: string): Promise<TenantSetting> {
    await this.findById(id);
    return this.prisma.tenantSetting.upsert({
      where: { tenantId: id },
      create: { tenantId: id },
      update: {},
    });
  }

  /**
   * Update (upsert) a tenant's Business Settings. Only supplied fields are
   * patched; the row is created if it doesn't exist yet.
   * @param id tenant id
   * @param dto settings fields to set
   * @param updatedBy SiteAdmin actor (for logs)
   * @throws TenantNotFoundException if the tenant is missing/soft-deleted
   */
  async updateSettings(
    id: string,
    dto: UpdateTenantSettingsDto,
    updatedBy: string,
  ): Promise<TenantSetting> {
    await this.findById(id);
    const setting = await this.prisma.tenantSetting.upsert({
      where: { tenantId: id },
      create: { tenantId: id, ...dto },
      update: { ...dto },
    });
    this.logger.log(`Tenant settings updated: ${id} by ${updatedBy}`);
    return setting;
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
   *
   * SiteAdmin requests carry no per-request tenant GUC, so the
   * `user_branch_profiles` lookup (RLS-protected, `tenant_id =
   * current_tenant_id()`) runs inside `runWithTenant(tenantId, …)` — same
   * pattern as `getBranchesForTenant` (CLAUDE.md §4.7). Without it, the query
   * silently returns zero rows instead of erroring, which is why this looked
   * like "no admin exists" rather than a permissions problem.
   * @param tenantId tenant id
   * @returns admin info, or null if none exists
   */
  async getBusinessAdmin(tenantId: string): Promise<BusinessAdminInfo | null> {
    return this.prisma.runWithTenant(tenantId, async () => {
      const profile = await this.prisma.userBranchProfile.findFirst({
        where: {
          tenantId,
          authRole: { key: 'business_admin' },
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
    });
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
   * Set the business admin's password to a SiteAdmin-chosen value. Unlike
   * {@link resetBusinessAdminPassword}, the password is supplied (not
   * generated) and flagged as non-temp so the admin isn't forced to change it.
   * @param tenantId tenant id
   * @param password the new plain-text password (policy-checked)
   * @param requestedBy SiteAdmin actor
   */
  async setBusinessAdminPassword(
    tenantId: string,
    password: string,
    requestedBy: string,
  ): Promise<{ adminPhone: string }> {
    const admin = await this.getBusinessAdmin(tenantId);
    if (!admin) {
      throw new InternalException('tenant-set-password-no-admin', {
        tenantId,
      });
    }

    // Defence in depth — the DTO enforces the policy at the pipe, re-check here.
    const passwordError = this.passwordService.validate(password);
    if (passwordError) {
      throw new ValidationException(passwordError, {
        adminPassword: passwordError,
      });
    }
    const passwordHash = await this.passwordService.hash(password);

    await this.prisma.personCredentials.update({
      where: { personId: admin.personId },
      data: {
        passwordHash,
        isTempPassword: false,
        failedAttempts: 0,
        lockedUntil: null,
      },
    });

    this.logger.log(
      `Business admin password set for tenant ${tenantId} by SiteAdmin ${requestedBy}`,
    );
    return { adminPhone: admin.phone ?? '' };
  }

  /**
   * Derive a URL-safe, unique subdomain slug from a business name. Lowercases,
   * collapses non-alphanumeric runs to hyphens, trims stray hyphens and pads
   * results shorter than the 3-char minimum, then appends a numeric suffix
   * until the slug is unused. Always satisfies the `CreateTenantDto` slug shape.
   * @param name business name to derive from
   */
  private async generateUniqueSlug(name: string): Promise<string> {
    const base = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 90);
    const candidate = base.length >= 3 ? base : `${base || 'biz'}-lab`;

    let slug = candidate;
    let suffix = 1;
    while (
      await this.prisma.tenant.findFirst({
        where: { slug, deletedAt: null },
        select: { id: true },
      })
    ) {
      slug = `${candidate}-${suffix++}`;
    }
    return slug;
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
