import { Tenant } from '@prisma/client';

/** Per-tenant locale & branding overrides (stored in the `settings` JSONB). */
export interface TenantSettings {
  timezone: string;
  currency: string;
  date_format: string;
  language: string;
  logo_url?: string;
  primary_color?: string;
  secondary_color?: string;
  app_name?: string;
}

/** Domain/response shape for a tenant (Prisma model is the DB source of truth). */
export type TenantEntity = Tenant;
