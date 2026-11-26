import { Injectable } from '@nestjs/common';
import { Prisma, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotFoundException } from '../../common/exceptions/kaltros.exception';
import {
  ChangePlanParams,
  RegisterSubscriptionParams,
  SubscriptionClient,
  SubscriptionEnvelope,
  SubscriptionPeer,
} from './subscription.client';
import { ChangePlanDto } from './dto/change-plan.dto';
import {
  SubscriptionBill,
  SubscriptionClientRecord,
  SubscriptionPlan,
} from './entities/subscription.entity';
import {
  SubscriptionBusinessIdMissingException,
  SubscriptionNotConfiguredException,
  SubscriptionPlanChangeFailedException,
  SubscriptionRegistrationFailedException,
} from './exceptions/subscription.exceptions';

/** The `Tenant` fields the subscription proxy needs to build the register payload. */
const TENANT_SELECT = {
  id: true,
  name: true,
  shortName: true,
  email: true,
  phone: true,
  addressLine: true,
  pincode: true,
  legacyTenantId: true,
  exchangeTenantId: true,
  subscriptionRegisteredAt: true,
  subscriptionClientId: true,
  city: { select: { name: true } },
  country: { select: { name: true } },
  area: { select: { name: true } },
} as const;

type TenantForSubscription = {
  id: string;
  name: string;
  shortName: string | null;
  email: string | null;
  phone: string | null;
  addressLine: string | null;
  pincode: string | null;
  legacyTenantId: number | null;
  exchangeTenantId: number | null;
  subscriptionRegisteredAt: Date | null;
  subscriptionClientId: string | null;
  city: { name: string } | null;
  country: { name: string } | null;
  area: { name: string } | null;
};

/**
 * Proxies the business-admin Subscription Plan screen to the external subscription
 * microservice (the `businessSubscription` flow ported from EzHealthTrack).
 * Kalnostics stores no subscription data — the server owns the client record,
 * plans and bills; this service resolves the caller's tenant into the integer
 * business id the server keys on, builds the signed register payload from the
 * tenant record, and maps the `{ s, data.original }` envelope into clean domain
 * shapes. `Tenant` is platform-level (no RLS), read directly via Prisma.
 */
@Injectable()
export class SubscriptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly client: SubscriptionClient,
  ) {}

  /**
   * The business's current subscription client record (`GET /clients/show`), or
   * `null` when the business is not yet registered on the subscription server.
   * @param tenantId the caller's tenant (from the JWT)
   * @throws SubscriptionNotConfiguredException when the integration is unconfigured
   * @throws SubscriptionBusinessIdMissingException when the tenant has no business id
   */
  async getSubscription(
    tenantId: string,
  ): Promise<SubscriptionClientRecord | null> {
    this.ensureConfigured();
    const { businessId, peer } = await this.resolveBusiness(tenantId);
    const resp = await this.client.getClient(peer, businessId);
    if (!this.client.isOk(resp)) return null;
    return (resp?.data?.original as SubscriptionClientRecord) ?? null;
  }

  /**
   * The active subscription plans offered to the business (`GET /plans`).
   * @param tenantId the caller's tenant (from the JWT)
   */
  async getPlans(tenantId: string): Promise<SubscriptionPlan[]> {
    this.ensureConfigured();
    const { peer } = await this.resolveBusiness(tenantId);
    const resp = await this.client.getPlans(peer);
    if (!this.client.isOk(resp)) return [];
    return this.listFrom<SubscriptionPlan>(resp);
  }

  /**
   * Register the business as a client on the subscription server (`POST /clients`)
   * — the "Register Subscription" action. Builds the payload from the tenant
   * record (name / address / contact), keyed by the resolved business id.
   *
   * Idempotent (mirrors {@link ExchangeRegistrationService}): a tenant already
   * registered (`subscriptionRegisteredAt` set) is not re-POSTed — its current
   * record is returned. A fresh registration persists `subscriptionRegisteredAt`,
   * `subscriptionClientId` and `subscriptionRegistrationMeta` on the tenant so the
   * SiteAdmin businesses list can show status without a live call.
   * @param tenantId the caller's tenant (from the JWT or SiteAdmin path)
   * @returns the created/current client record (`data.original`)
   * @throws SubscriptionRegistrationFailedException when the server rejects the call
   */
  async register(tenantId: string): Promise<SubscriptionClientRecord> {
    this.ensureConfigured();
    const { tenant, businessId, peer } = await this.resolveBusiness(tenantId);

    // Already registered → return the current record without re-POSTing.
    if (tenant.subscriptionRegisteredAt) {
      const existing = await this.client.getClient(peer, businessId);
      return (existing?.data?.original as SubscriptionClientRecord) ?? {};
    }

    const params = this.buildRegisterParams(tenant, businessId);
    const resp = await this.client.registerClient(peer, params);
    if (!this.client.isOk(resp)) {
      throw new SubscriptionRegistrationFailedException(tenantId, {
        businessId,
        message: resp?.m ?? null,
      });
    }

    const original = (resp?.data?.original as SubscriptionClientRecord) ?? {};
    const rawId = (original as { id?: unknown }).id;
    const subscriptionClientId =
      typeof rawId === 'string' || typeof rawId === 'number'
        ? String(rawId)
        : null;
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        subscriptionRegisteredAt: new Date(),
        subscriptionClientId,
        subscriptionRegistrationMeta: (original ??
          Prisma.JsonNull) as Prisma.InputJsonValue,
      },
    });
    return original;
  }

  /**
   * Change the business's subscription plan (`POST /orders`).
   * @param tenantId the caller's tenant (from the JWT)
   * @param dto the selected plan (id/code + default flag)
   * @returns the order result (`data.original`)
   * @throws SubscriptionPlanChangeFailedException when the server rejects the call
   */
  async changePlan(
    tenantId: string,
    dto: ChangePlanDto,
  ): Promise<Record<string, unknown>> {
    this.ensureConfigured();
    const { businessId, peer } = await this.resolveBusiness(tenantId);
    const params: ChangePlanParams = {
      business_id: businessId,
      plan_id: dto.planId,
      plan_code: dto.planCode ?? '',
      set_default: dto.isDefault ? '1' : '0',
    };
    const resp = await this.client.changePlan(peer, params);
    if (!this.client.isOk(resp)) {
      throw new SubscriptionPlanChangeFailedException(tenantId, {
        businessId,
        planId: dto.planId,
        message: resp?.m ?? null,
      });
    }

    // Persist the selected plan locally so the business reflects an active plan.
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        subscriptionPlanId: dto.planId,
        subscriptionStatus: SubscriptionStatus.ACTIVE,
      },
    });
    return (resp?.data?.original as Record<string, unknown>) ?? {};
  }

  /**
   * The business's subscription bills (`GET /bills`).
   * @param tenantId the caller's tenant (from the JWT)
   */
  async getBills(tenantId: string): Promise<SubscriptionBill[]> {
    this.ensureConfigured();
    const { businessId, peer } = await this.resolveBusiness(tenantId);
    const resp = await this.client.getBills(peer, businessId);
    if (!this.client.isOk(resp)) return [];
    return this.listFrom<SubscriptionBill>(resp);
  }

  /**
   * One subscription bill as JSON (`GET /bills/json`), or `null` when not found.
   * @param tenantId the caller's tenant (from the JWT)
   * @param billId the bill id
   */
  async getBill(tenantId: string, billId: string): Promise<unknown> {
    this.ensureConfigured();
    const { businessId, peer } = await this.resolveBusiness(tenantId);
    const resp = await this.client.getBill(peer, billId, businessId);
    return resp?.bill_json ?? null;
  }

  /**
   * One subscription bill as a PDF (`GET /bills/pdf`) — the raw PDF bytes.
   * @param tenantId the caller's tenant (from the JWT)
   * @param billId the bill id
   */
  async downloadBill(tenantId: string, billId: string): Promise<Buffer> {
    this.ensureConfigured();
    const { businessId, peer } = await this.resolveBusiness(tenantId);
    return this.client.downloadBill(peer, billId, businessId);
  }

  /** Guard: the integration must be configured before any proxy call. */
  private ensureConfigured(): void {
    if (!this.client.isConfigured()) {
      throw new SubscriptionNotConfiguredException();
    }
  }

  /**
   * Load the tenant and resolve the integer business id + signed peer context the
   * subscription server keys the client by (`legacyTenantId`, falling back to
   * `exchangeTenantId`).
   * @param tenantId the tenant's UUID
   * @throws NotFoundException when the tenant does not exist
   * @throws SubscriptionBusinessIdMissingException when it has no business id
   */
  private async resolveBusiness(tenantId: string): Promise<{
    tenant: TenantForSubscription;
    businessId: number;
    peer: SubscriptionPeer;
  }> {
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: tenantId, deletedAt: null },
      select: TENANT_SELECT,
    });
    if (!tenant) {
      throw new NotFoundException('tenant', tenantId);
    }
    const businessId = tenant.legacyTenantId ?? tenant.exchangeTenantId;
    if (businessId == null) {
      throw new SubscriptionBusinessIdMissingException(tenantId);
    }
    return {
      tenant,
      businessId,
      peer: { tenantId: String(businessId), tenantInfo: tenant.name },
    };
  }

  /**
   * Build the `POST /clients` payload from the tenant record, mirroring the legacy
   * `registerBusinessSubscription` mapping. PAN/GST/contact-person are not held on
   * the Tenant, so they are sent blank (as the legacy flow did when absent).
   * @param tenant the loaded tenant
   * @param businessId the resolved integer business id
   */
  private buildRegisterParams(
    tenant: TenantForSubscription,
    businessId: number,
  ): RegisterSubscriptionParams {
    return {
      name: tenant.name,
      code: tenant.shortName ?? '',
      address: tenant.addressLine ?? '',
      address_2: tenant.area?.name ?? '',
      city: tenant.city?.name ?? '',
      country: tenant.country?.name ?? '',
      postcode: tenant.pincode ?? '',
      contact_email: tenant.email ?? '',
      contact_phone: tenant.phone ?? '',
      contact_person: '',
      pan_number: '',
      gst_number: '',
      gst_state: '',
      business_id: businessId,
    };
  }

  /** Extract a list payload from `data.original.data`, tolerating a missing/odd shape. */
  private listFrom<T>(resp: SubscriptionEnvelope | null): T[] {
    const data = (resp?.data?.original as { data?: unknown } | undefined)?.data;
    return Array.isArray(data) ? (data as T[]) : [];
  }
}
