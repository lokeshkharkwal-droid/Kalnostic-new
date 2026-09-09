/**
 * EzHealthTrack → Kalnostics-New data migration runner.
 *
 * Migrates ONE legacy tenant's Tenant → Branches → Patients → Referring Panels
 * out of the legacy EzHealthTrack MySQL database into this app's PostgreSQL,
 * REUSING the real Nest services (so DTO logic, sequential-code generation, RLS
 * tenant context and audit all behave exactly as in production). It never inserts
 * with a raw Prisma client.
 *
 * The run is IDEMPOTENT: every stage looks the row up by its legacy id first and
 * skips it if already migrated, so re-running only fills gaps. Provenance is kept
 * in the `legacy*` columns added in the 20260902120000 migration.
 *
 * Configuration (environment variables — put them in the app `.env` or export in
 * the shell; they are read verbatim, NOT validated by the app's env schema):
 *   LEGACY_TENANT_ID           (required) source business_info.BUSINESS_ID
 *   Legacy MySQL connection — either a URL or discrete parts:
 *     LEGACY_MYSQL_URL         mysql://user:pass@host:3306/dbname
 *     …or LEGACY_MYSQL_HOST / _PORT (3306) / _USER / _PASSWORD / _DATABASE
 *   New tenant's business-admin (used only when the tenant is created fresh):
 *     LEGACY_ADMIN_PHONE       (required) 10-digit login phone, globally unique
 *     LEGACY_ADMIN_PASSWORD    (required) ≥8 chars, 1 upper, 1 digit
 *     LEGACY_ADMIN_FIRST_NAME  (default: legacy business contact first name)
 *     LEGACY_ADMIN_LAST_NAME / _EMAIL   (optional)
 *   Locale for a fresh tenant:
 *     LEGACY_TENANT_TIMEZONE   (default Asia/Kolkata)
 *     LEGACY_TENANT_CURRENCY   (default INR)
 *   Behaviour:
 *     MIGRATION_MISSING_MOBILE 'skip' (default) | 'placeholder' — how to handle a
 *                              legacy patient with no usable mobile number
 *     MIGRATION_PATIENT_LIMIT  optional cap on patients (for a trial run)
 *
 * Run:  pnpm migrate:ezht
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createConnection,
  type Connection,
  type RowDataPacket,
} from 'mysql2/promise';
import {
  BranchType,
  Gender,
  ReferralClientType,
  Relationship,
  Salutation,
} from '@prisma/client';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantService } from '../src/modules/tenant/tenant.service';
import { BranchService } from '../src/modules/branch/branch.service';
import { PatientService } from '../src/modules/patient/patient.service';
import { ReferralPanelService } from '../src/modules/referral-panel/referral-panel.service';
import type { CreateTenantDto } from '../src/modules/tenant/dto/create-tenant.dto';
import type { CreateBranchDto } from '../src/modules/branch/dto/create-branch.dto';
import type { CreatePatientDto } from '../src/modules/patient/dto/create-patient.dto';
import type { CreateReferralPanelDto } from '../src/modules/referral-panel/dto/create-referral-panel.dto';

const logger = new Logger('EzhtMigration');

/** A legacy MySQL row as an untyped bag; values are coerced at the edge. */
type LegacyRow = RowDataPacket & Record<string, unknown>;

// ── small coercion helpers (legacy MySQL returns mixed string/number/Date) ──────
function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}
function intOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}
function req(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(`Missing required env var ${name}`);
  }
  return v.trim();
}

const AADHAAR = /^\d{12}$/;
const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Map a legacy BUSINESS_LOCATION_TYPE to a Kalnostics BranchType (best-effort). */
function mapBranchType(legacy: unknown): BranchType {
  const key = (str(legacy) ?? '').toUpperCase().replace(/[^A-Z]/g, '');
  const table: Record<string, BranchType> = {
    LAB: BranchType.DIAGNOSTIC,
    DIAGNOSTIC: BranchType.DIAGNOSTIC,
    RADIOLOGY: BranchType.RADIOLOGY,
    OPD: BranchType.OPD,
    IPD: BranchType.IPD,
    PHARMACY: BranchType.PHARMACY,
    BLOODBANK: BranchType.BLOOD_BANK,
    FRANCHISE: BranchType.FRANCHISE,
    COMBINE: BranchType.COMBINED,
    COMBINEBRANCH: BranchType.COMBINED,
    COMBINED: BranchType.COMBINED,
  };
  return table[key] ?? BranchType.DIAGNOSTIC;
}

/** Map a legacy PATIENT_GENDER ('Male'/'Female'/'Other') to the Gender enum. */
function mapGender(legacy: unknown): Gender | undefined {
  const g = (str(legacy) ?? '').toUpperCase();
  if (g.startsWith('M')) return Gender.MALE;
  if (g.startsWith('F')) return Gender.FEMALE;
  if (g === '' ) return undefined;
  return Gender.OTHER;
}

/** Map a legacy salutation ('Mr.'/'Mrs.'/'Ms.'/'Dr.'/'Prof.') to the enum. */
function mapSalutation(legacy: unknown): Salutation | undefined {
  const s = (str(legacy) ?? '').toLowerCase().replace(/\./g, '');
  if (s === 'dr') return Salutation.DR;
  if (s === 'mr') return Salutation.MR;
  if (s === 'mrs') return Salutation.MRS;
  if (s === 'ms' || s === 'miss') return Salutation.MS;
  if (s === 'prof') return Salutation.PROF;
  return undefined;
}

/**
 * Load an id→name map from a legacy geo lookup table for a set of ids. Table and
 * column names are hardcoded (never user input), so interpolating them is safe.
 */
async function loadGeoNames(
  mysql: Connection,
  table: string,
  idCol: string,
  nameCol: string,
  ids: number[],
): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return map;
  for (const chunk of chunkArray(unique, 500)) {
    const ph = chunk.map(() => '?').join(',');
    const [rows] = await mysql.query<LegacyRow[]>(
      `SELECT ${idCol} AS id, ${nameCol} AS name FROM ${table} WHERE ${idCol} IN (${ph})`,
      chunk,
    );
    for (const r of rows) {
      const id = intOrNull(r.id);
      const nm = str(r.name);
      if (id !== null && nm) map.set(id, nm);
    }
  }
  return map;
}

/**
 * Resolve a legacy geo value that may be a numeric id (→ look up its name) or an
 * already-plain name (→ pass through). A numeric id we can't resolve is dropped
 * (returns undefined) rather than stored as a bare number.
 */
function resolveGeoValue(
  raw: unknown,
  map: Map<number, string>,
): string | undefined {
  const s = str(raw);
  if (!s) return undefined;
  const n = intOrNull(s);
  if (n !== null) return map.get(n); // numeric id → name (or undefined if unknown)
  return s; // already a name
}

/** Map a legacy patient_family.RELATION string to the Relationship enum. */
function mapRelationship(legacy: unknown): Relationship {
  const r = (str(legacy) ?? '').toLowerCase();
  // kalnostics has no in-law variants — fold them into OTHER (check first, so
  // "father-in-law" isn't caught by the "father" rule below).
  if (r.includes('in-law') || r.includes('in law')) return Relationship.OTHER;
  if (r.includes('daughter')) return Relationship.DAUGHTER;
  if (r.includes('son')) return Relationship.SON;
  if (r.includes('spouse') || r.includes('husband') || r.includes('wife'))
    return Relationship.SPOUSE;
  if (r.includes('father')) return Relationship.FATHER;
  if (r.includes('mother')) return Relationship.MOTHER;
  if (r.includes('brother')) return Relationship.BROTHER;
  if (r.includes('sister')) return Relationship.SISTER;
  if (r.includes('sibling')) return Relationship.SIBLING;
  if (r.includes('guardian')) return Relationship.GUARDIAN;
  if (r.includes('friend')) return Relationship.FRIEND;
  if (r.includes('self')) return Relationship.SELF;
  return Relationship.OTHER;
}

/** Derive a ≤5-char branch shortName from the legacy short_name or the name. */
function deriveShortName(shortName: unknown, name: string): string {
  const explicit = str(shortName);
  if (explicit) return explicit.slice(0, 5);
  const alnum = name.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return (alnum.slice(0, 5) || 'BR').padEnd(2, 'X');
}

/** A legacy DOB is "unknown" when null, epoch-ish, or the 1900-01-01 sentinel. */
function mapDob(legacy: unknown): string | undefined {
  const s = str(legacy);
  if (!s) return undefined;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return undefined;
  if (d.getUTCFullYear() <= 1900) return undefined;
  return d.toISOString().slice(0, 10);
}

/** Pull the first `{num}` / `{email}` out of a legacy JSON-array text column. */
function firstFromJsonArray(raw: unknown, key: 'num' | 'email'): string | null {
  const s = str(raw);
  if (!s) return null;
  try {
    const parsed = JSON.parse(s) as Array<Record<string, unknown>>;
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        const val = str(item?.[key]);
        if (val) return val;
      }
    }
  } catch {
    // not JSON — ignore
  }
  return null;
}

interface RunReport {
  legacyTenantId: number;
  newTenantId: string | null;
  tenant: { created: boolean; skipped: boolean };
  branches: { created: number; skipped: number };
  patients: {
    created: number;
    skipped: number;
    familyBypass: Array<{ legacyPatientId: number; mobile: string }>;
    missingMobile: Array<{ legacyPatientId: number; name: string }>;
    errors: Array<{ legacyPatientId: number; message: string }>;
  };
  panels: {
    created: number;
    skipped: number;
    errors: Array<{ legacyId: number; message: string }>;
  };
  family: {
    created: number;
    skipped: number;
    unresolved: Array<{ anchorLegacyId: number; memberLegacyId: number | null }>;
    errors: Array<{ anchorLegacyId: number; memberLegacyId: number; message: string }>;
  };
}

async function main(): Promise<void> {
  const legacyTenantId = Number(req('LEGACY_TENANT_ID'));
  if (!Number.isInteger(legacyTenantId)) {
    throw new Error('LEGACY_TENANT_ID must be an integer');
  }
  const missingMobilePolicy =
    process.env.MIGRATION_MISSING_MOBILE === 'placeholder'
      ? 'placeholder'
      : 'skip';
  const patientLimit = intOrNull(process.env.MIGRATION_PATIENT_LIMIT);

  const report: RunReport = {
    legacyTenantId,
    newTenantId: null,
    tenant: { created: false, skipped: false },
    branches: { created: 0, skipped: 0 },
    patients: {
      created: 0,
      skipped: 0,
      familyBypass: [],
      missingMobile: [],
      errors: [],
    },
    panels: { created: 0, skipped: 0, errors: [] },
    family: { created: 0, skipped: 0, unresolved: [], errors: [] },
  };

  const mysql = await connectLegacy();
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const prisma = app.get(PrismaService);
  const tenantService = app.get(TenantService);
  const branchService = app.get(BranchService);
  const patientService = app.get(PatientService);
  const referralPanelService = app.get(ReferralPanelService);

  try {
    // ── Stage 1: Tenant ──────────────────────────────────────────────────────
    const newTenantId = await migrateTenant(
      mysql,
      prisma,
      tenantService,
      legacyTenantId,
      report,
    );
    report.newTenantId = newTenantId;

    // ── Stage 2: Branches ────────────────────────────────────────────────────
    const branchMap = await migrateBranches(
      mysql,
      prisma,
      branchService,
      legacyTenantId,
      newTenantId,
      report,
    );
    const mainBranchId = await resolveMainBranchId(
      prisma,
      newTenantId,
      branchMap,
    );

    // ── Stage 3: Patients ────────────────────────────────────────────────────
    // Family members are flagged at creation time (see loadFamilyMemberLegacyIds)
    // so shared-mobile households are handled deterministically.
    const memberLegacyIds = await loadFamilyMemberLegacyIds(mysql, legacyTenantId);
    await migratePatients(
      mysql,
      prisma,
      patientService,
      legacyTenantId,
      newTenantId,
      branchMap,
      mainBranchId,
      missingMobilePolicy,
      patientLimit,
      memberLegacyIds,
      report,
    );

    // ── Stage 3b: Family links (anchor ↔ member) ─────────────────────────────
    await migrateFamilyLinks(
      mysql,
      prisma,
      patientService,
      legacyTenantId,
      newTenantId,
      report,
    );

    // ── Stage 4: Referring panels → ReferralPanel ────────────────────────────
    await migratePanels(
      mysql,
      prisma,
      referralPanelService,
      legacyTenantId,
      newTenantId,
      branchMap,
      report,
    );
  } finally {
    await mysql.end();
    await app.close();
  }

  writeReport(report);
  logger.log(
    `Done. tenant=${report.tenant.created ? 'created' : 'existing'} ` +
      `branches +${report.branches.created}/skip ${report.branches.skipped} ` +
      `patients +${report.patients.created}/skip ${report.patients.skipped} ` +
      `family +${report.family.created}/skip ${report.family.skipped} ` +
      `panels +${report.panels.created}/skip ${report.panels.skipped}`,
  );
}

async function connectLegacy(): Promise<Connection> {
  const url = process.env.LEGACY_MYSQL_URL;
  if (url) {
    return createConnection(url);
  }
  return createConnection({
    host: req('LEGACY_MYSQL_HOST'),
    port: Number(process.env.LEGACY_MYSQL_PORT ?? '3306'),
    user: req('LEGACY_MYSQL_USER'),
    password: process.env.LEGACY_MYSQL_PASSWORD ?? '',
    database: req('LEGACY_MYSQL_DATABASE'),
    // Return DATE/DATETIME as raw 'YYYY-MM-DD' strings instead of JS Date objects
    // (which mysql2 builds at the driver's LOCAL midnight). This keeps DOB from
    // shifting a day when later normalised to UTC. See mapDob.
    dateStrings: true,
  });
}

/** Create the tenant from the legacy business (idempotent by legacy_tenant_id). */
async function migrateTenant(
  mysql: Connection,
  prisma: PrismaService,
  tenantService: TenantService,
  legacyTenantId: number,
  report: RunReport,
): Promise<string> {
  const existing = await prisma.tenant.findFirst({
    where: { legacyTenantId, deletedAt: null },
    select: { id: true },
  });
  if (existing) {
    report.tenant.skipped = true;
    logger.log(`Tenant already migrated (${existing.id}); reusing.`);
    return existing.id;
  }

  const [rows] = await mysql.query<LegacyRow[]>(
    'SELECT * FROM business_info WHERE BUSINESS_ID = ? LIMIT 1',
    [legacyTenantId],
  );
  const biz = rows[0];
  if (!biz) {
    throw new Error(
      `No business_info row with BUSINESS_ID=${legacyTenantId} in legacy DB`,
    );
  }

  const name = str(biz.BUSINESS_LOCATION_TITLE) ?? `Tenant ${legacyTenantId}`;
  const dto: CreateTenantDto = {
    name,
    adminFirstName:
      str(process.env.LEGACY_ADMIN_FIRST_NAME) ??
      str(biz.BUSINESS_PERSON_FNAME) ??
      'Admin',
    adminLastName:
      str(process.env.LEGACY_ADMIN_LAST_NAME) ??
      str(biz.BUSINESS_PERSON_LNAME) ??
      undefined,
    adminPhone: req('LEGACY_ADMIN_PHONE'),
    adminEmail: str(process.env.LEGACY_ADMIN_EMAIL) ?? undefined,
    adminPassword: req('LEGACY_ADMIN_PASSWORD'),
    email: str(biz.BUSINESS_EMAIL) ?? undefined,
    phone: str(biz.BUSINESS_MOBILE_NUMBER) ?? undefined,
    shortName: str(biz.short_name) ?? undefined,
    addressLine: str(biz.BUSINESS_ADDRESS) ?? undefined,
    pincode: str(biz.BUSINESS_ZIPCODE) ?? undefined,
    settings: {
      timezone: process.env.LEGACY_TENANT_TIMEZONE ?? 'Asia/Kolkata',
      currency: process.env.LEGACY_TENANT_CURRENCY ?? 'INR',
    },
  } as CreateTenantDto;

  const { tenant } = await tenantService.create(dto, 'ezht-migration', {
    legacyTenantId,
  });
  report.tenant.created = true;
  logger.log(`Created tenant ${tenant.id} ("${name}").`);
  return tenant.id;
}

/** Migrate all child businesses to Branches; returns legacyBranchId → newId map. */
async function migrateBranches(
  mysql: Connection,
  prisma: PrismaService,
  branchService: BranchService,
  legacyTenantId: number,
  newTenantId: string,
  report: RunReport,
): Promise<Map<number, string>> {
  const [rows] = await mysql.query<LegacyRow[]>(
    'SELECT * FROM business_info WHERE BUSINESS_PARENT = ? ORDER BY BUSINESS_ID',
    [legacyTenantId],
  );

  // Branch license number lives in a separate table (business_license.LICENSE),
  // keyed by BUSINESS_ID. Pre-load the first ACTIVE license per branch.
  const [licRows] = await mysql.query<LegacyRow[]>(
    `SELECT BUSINESS_ID AS bid, LICENSE AS lic FROM business_license
      WHERE FLAG = 0 AND BUSINESS_ID IN (
        SELECT BUSINESS_ID FROM business_info WHERE BUSINESS_PARENT = ?
      ) ORDER BY BUSINESS_LICENSE_ID`,
    [legacyTenantId],
  );
  const licenseByBranch = new Map<number, string>();
  for (const l of licRows) {
    const bid = intOrNull(l.bid);
    const lic = str(l.lic);
    if (bid !== null && lic && !licenseByBranch.has(bid)) licenseByBranch.set(bid, lic);
  }

  // Legacy stores country/state/city as numeric ids in the BUSINESS_*_NAME
  // columns; resolve them to names via the geo lookup tables.
  const gid = (v: unknown): number[] => {
    const n = intOrNull(v);
    return n !== null && n > 0 ? [n] : [];
  };
  const countryMap = await loadGeoNames(mysql, 'country_table', 'COUNTRY_ID', 'COUNTRY_NAME', rows.flatMap((b) => gid(b.BUSINESS_COUNTRY_NAME)));
  const stateMap = await loadGeoNames(mysql, 'state_table', 'STATE_ID', 'STATE_NAME', rows.flatMap((b) => gid(b.BUSINESS_STATE_NAME)));
  const cityMap = await loadGeoNames(mysql, 'city_table', 'CITY_ID', 'CITY_NAME', rows.flatMap((b) => gid(b.BUSINESS_CITY_NAME)));

  const map = new Map<number, string>();
  // Seed the map with any branches already migrated (idempotent re-run).
  const already = await prisma.runWithTenant(newTenantId, () =>
    prisma.branch.findMany({
      where: { tenantId: newTenantId, deletedAt: null, legacyBranchId: { not: null } },
      select: { id: true, legacyBranchId: true },
    }),
  );
  for (const b of already) {
    if (b.legacyBranchId !== null) map.set(b.legacyBranchId, b.id);
  }

  for (const biz of rows) {
    const legacyBranchId = intOrNull(biz.BUSINESS_ID);
    if (legacyBranchId === null) continue;
    if (map.has(legacyBranchId)) {
      report.branches.skipped += 1;
      continue;
    }
    const name = str(biz.BUSINESS_LOCATION_TITLE) ?? `Branch ${legacyBranchId}`;
    const dto: CreateBranchDto = {
      name,
      branchType: mapBranchType(biz.BUSINESS_LOCATION_TYPE),
      shortName: deriveShortName(biz.short_name, name),
      addressLine: str(biz.BUSINESS_ADDRESS) ?? undefined,
      pincode: str(biz.BUSINESS_ZIPCODE) ?? undefined,
      phone: str(biz.BUSINESS_MOBILE_NUMBER) ?? undefined,
      email: EMAIL.test(str(biz.BUSINESS_EMAIL) ?? '')
        ? (str(biz.BUSINESS_EMAIL) ?? undefined)
        : undefined,
      country: countryMap.get(intOrNull(biz.BUSINESS_COUNTRY_NAME) ?? -1) ?? undefined,
      state: stateMap.get(intOrNull(biz.BUSINESS_STATE_NAME) ?? -1) ?? undefined,
      city: cityMap.get(intOrNull(biz.BUSINESS_CITY_NAME) ?? -1) ?? undefined,
      establishedDate: str(biz.established_date) ?? undefined,
      gstNo: str(biz.gst_number) ?? undefined,
      licenseNo: licenseByBranch.get(legacyBranchId) ?? undefined,
    } as CreateBranchDto;

    const branch = await prisma.runWithTenant(newTenantId, () =>
      branchService.create(newTenantId, dto, undefined, { legacyBranchId }),
    );
    map.set(legacyBranchId, branch.id);
    report.branches.created += 1;
    logger.log(`  branch ${branch.code} ← legacy ${legacyBranchId} ("${name}")`);
  }
  return map;
}

/** The tenant's main branch id (fallback for patients with no branch relation). */
async function resolveMainBranchId(
  prisma: PrismaService,
  newTenantId: string,
  branchMap: Map<number, string>,
): Promise<string | null> {
  const main = await prisma.runWithTenant(newTenantId, () =>
    prisma.tenantMainBranch.findUnique({
      where: { tenantId: newTenantId },
      select: { branchId: true },
    }),
  );
  if (main?.branchId) return main.branchId;
  // Fall back to any migrated branch.
  const first = branchMap.values().next();
  return first.done ? null : first.value;
}

/**
 * Legacy PATIENT_IDs that are family MEMBERS for this tenant — i.e. they appear
 * as `patient_family.FAMILY_MEMBER_PATIENT_ID` on an active row whose anchor
 * belongs to the tenant. Used to flag them `isFamilyMember` at CREATION time, so
 * that in a shared-mobile household the anchor (never a member) is the record
 * that holds the number and stays off the family flag — deterministically,
 * regardless of the order patients are processed in.
 */
async function loadFamilyMemberLegacyIds(
  mysql: Connection,
  legacyTenantId: number,
): Promise<Set<number>> {
  const [rows] = await mysql.query<LegacyRow[]>(
    `SELECT DISTINCT pf.FAMILY_MEMBER_PATIENT_ID AS m
       FROM patient_family pf
      WHERE pf.FLAG = 0
        AND pf.FAMILY_MEMBER_PATIENT_ID IS NOT NULL
        AND pf.PATIENT_ID IN (
          SELECT DISTINCT patient_id FROM user_patient_relation WHERE tenant_id = ?
        )`,
    [legacyTenantId],
  );
  const set = new Set<number>();
  for (const r of rows) {
    const m = intOrNull(r.m);
    if (m !== null) set.add(m);
  }
  return set;
}

/** Migrate patients owned by the tenant (resolved via user_patient_relation). */
async function migratePatients(
  mysql: Connection,
  prisma: PrismaService,
  patientService: PatientService,
  legacyTenantId: number,
  newTenantId: string,
  branchMap: Map<number, string>,
  mainBranchId: string | null,
  missingMobilePolicy: 'skip' | 'placeholder',
  patientLimit: number | null,
  memberLegacyIds: Set<number>,
  report: RunReport,
): Promise<void> {
  // Ownership + branch: a patient can have several user_patient_relation rows —
  // one per branch they've been seen at, plus a tenant-level ('B') row. Order by
  // `id` (chronological) and keep the FIRST branch-type relation that maps to a
  // migrated branch: that is the patient's REGISTRATION branch. ('B' rows point
  // at the tenant, not a branch, so they never set a branch — patients with only
  // a 'B' relation fall back to the tenant's main branch.)
  const [uprRows] = await mysql.query<LegacyRow[]>(
    'SELECT id, patient_id, entity_id, entity_type FROM user_patient_relation WHERE tenant_id = ? ORDER BY id',
    [legacyTenantId],
  );
  const branchByPatient = new Map<number, string>();
  const hasBranch = new Set<number>();
  const patientIds: number[] = [];
  for (const r of uprRows) {
    const pid = intOrNull(r.patient_id);
    if (pid === null) continue;
    if (!branchByPatient.has(pid)) {
      patientIds.push(pid);
      branchByPatient.set(pid, mainBranchId ?? ''); // fallback until a branch is found
    }
    if ((str(r.entity_type) ?? '').toLowerCase() !== 'branch') continue;
    if (hasBranch.has(pid)) continue; // first (earliest) branch wins
    const entityId = intOrNull(r.entity_id);
    const mapped = entityId !== null ? branchMap.get(entityId) : undefined;
    if (mapped) {
      branchByPatient.set(pid, mapped);
      hasBranch.add(pid);
    }
  }
  if (patientIds.length === 0) {
    logger.log('No patients found for this tenant.');
    return;
  }
  const targetIds = patientLimit ? patientIds.slice(0, patientLimit) : patientIds;

  // Which of these are already migrated?
  const done = await prisma.runWithTenant(newTenantId, () =>
    prisma.patient.findMany({
      where: {
        tenantId: newTenantId,
        deletedAt: null,
        legacyPatientId: { in: targetIds },
      },
      select: { legacyPatientId: true },
    }),
  );
  const doneSet = new Set(done.map((p) => p.legacyPatientId));

  const pending = targetIds.filter((id) => !doneSet.has(id));
  report.patients.skipped += targetIds.length - pending.length;
  if (pending.length === 0) {
    logger.log('All patients already migrated.');
    return;
  }

  // Fetch legacy detail rows in chunks (avoid a huge IN list).
  const detail = new Map<number, LegacyRow>();
  for (const chunk of chunkArray(pending, 500)) {
    const placeholders = chunk.map(() => '?').join(',');
    const [rows] = await mysql.query<LegacyRow[]>(
      `SELECT pr.PATIENT_ID, pr.salutation, pr.PATIENT_FIRST_NAME, pr.PATIENT_MIDDLE_NAME,
              pr.PATIENT_LAST_NAME, pr.PATIENT_MOBILE_NUMBER, pr.PATIENT_EMAIL,
              pr.whatsapp_number, pr.pan_number,
              ppi.PATIENT_DOB, ppi.PATIENT_GENDER, ppi.PATIENT_ADDRESS1, ppi.PATIENT_ADDRESS2,
              ppi.PATIENT_ZIP, ppi.PATIENT_AADHAR_NUMBER, ppi.PATIENT_PASSPORT_NUMBER,
              ppi.PATIENT_CONTRY, ppi.PATIENT_STATE, ppi.PATIENT_CITY, ppi.PATIENT_AREA
         FROM patientregister pr
         LEFT JOIN patient_personal_info ppi ON ppi.PATIENT_ID = pr.PATIENT_ID
        WHERE pr.PATIENT_ID IN (${placeholders})`,
      chunk,
    );
    for (const r of rows) {
      const id = intOrNull(r.PATIENT_ID);
      if (id !== null) detail.set(id, r);
    }
  }

  // Resolve patient country/state/city/area ids → names via the geo lookups.
  const dv = detail.values();
  const detailRows = [...dv];
  const pgid = (v: unknown): number[] => {
    const n = intOrNull(v);
    return n !== null && n > 0 ? [n] : [];
  };
  const countryMap = await loadGeoNames(mysql, 'country_table', 'COUNTRY_ID', 'COUNTRY_NAME', detailRows.flatMap((r) => pgid(r.PATIENT_CONTRY)));
  const stateMap = await loadGeoNames(mysql, 'state_table', 'STATE_ID', 'STATE_NAME', detailRows.flatMap((r) => pgid(r.PATIENT_STATE)));
  const cityMap = await loadGeoNames(mysql, 'city_table', 'CITY_ID', 'CITY_NAME', detailRows.flatMap((r) => pgid(r.PATIENT_CITY)));
  const areaMap = await loadGeoNames(mysql, 'area_table', 'AREA_ID', 'AREA_NAME', detailRows.flatMap((r) => pgid(r.PATIENT_AREA)));

  // Emergency contact + membership number live in the patient_fields EAV table
  // (field_name = EMERGENCY_CONTACT_NAME / EMERGENCY_CONTACT_NUMBER /
  // MEMBERSHIP_NUMBER). Pre-load them per patient in chunks.
  const fieldsByPatient = new Map<
    number,
    { membership?: string; ecName?: string; ecNumber?: string }
  >();
  for (const chunk of chunkArray(pending, 500)) {
    const placeholders = chunk.map(() => '?').join(',');
    const [frows] = await mysql.query<LegacyRow[]>(
      `SELECT patient_id, field_name, field_value FROM patient_fields
        WHERE tenant_id = ?
          AND field_name IN ('MEMBERSHIP_NUMBER','EMERGENCY_CONTACT_NAME','EMERGENCY_CONTACT_NUMBER')
          AND patient_id IN (${placeholders})`,
      [legacyTenantId, ...chunk],
    );
    for (const f of frows) {
      const id = intOrNull(f.patient_id);
      const val = str(f.field_value);
      if (id === null || !val) continue;
      const entry = fieldsByPatient.get(id) ?? {};
      const fn = str(f.field_name);
      if (fn === 'MEMBERSHIP_NUMBER') entry.membership = val;
      else if (fn === 'EMERGENCY_CONTACT_NAME') entry.ecName = val;
      else if (fn === 'EMERGENCY_CONTACT_NUMBER') entry.ecNumber = val;
      fieldsByPatient.set(id, entry);
    }
  }

  for (const legacyPatientId of pending) {
    const row = detail.get(legacyPatientId);
    if (!row) {
      report.patients.errors.push({
        legacyPatientId,
        message: 'no patientregister row',
      });
      continue;
    }
    const firstName = str(row.PATIENT_FIRST_NAME) ?? 'Unknown';
    let mobile = str(row.PATIENT_MOBILE_NUMBER);
    if (!mobile || mobile.length < 4) {
      if (missingMobilePolicy === 'skip') {
        report.patients.missingMobile.push({ legacyPatientId, name: firstName });
        continue;
      }
      // placeholder → a synthetic, marked as family member to bypass the
      // per-tenant active-mobile unique index.
      mobile = `EZHT-${legacyPatientId}`;
    }

    const email = str(row.PATIENT_EMAIL);
    const aadhaar = str(row.PATIENT_AADHAR_NUMBER);
    const pan = str(row.pan_number);
    const zip = str(row.PATIENT_ZIP);
    const fields = fieldsByPatient.get(legacyPatientId) ?? {};

    const dto: CreatePatientDto = {
      salutation: mapSalutation(row.salutation),
      firstName,
      middleName: str(row.PATIENT_MIDDLE_NAME) ?? undefined,
      lastName: str(row.PATIENT_LAST_NAME) ?? undefined,
      mobile,
      // Globally-unique manual UMID (branches have no auto-format post-migration).
      umId: `EZHT-${legacyTenantId}-${legacyPatientId}`,
      gender: mapGender(row.PATIENT_GENDER),
      dateOfBirth: mapDob(row.PATIENT_DOB),
      whatsappNumber: str(row.whatsapp_number) ?? undefined,
      email: email && EMAIL.test(email) ? email : undefined,
      country: countryMap.get(intOrNull(row.PATIENT_CONTRY) ?? -1) ?? undefined,
      state: stateMap.get(intOrNull(row.PATIENT_STATE) ?? -1) ?? undefined,
      city: cityMap.get(intOrNull(row.PATIENT_CITY) ?? -1) ?? undefined,
      area: areaMap.get(intOrNull(row.PATIENT_AREA) ?? -1) ?? undefined,
      addressLine1: str(row.PATIENT_ADDRESS1) ?? undefined,
      addressLine2: str(row.PATIENT_ADDRESS2) ?? undefined,
      pincode: zip && zip !== '0' ? zip : undefined,
      aadhaarNumber: aadhaar && AADHAAR.test(aadhaar) ? aadhaar : undefined,
      panNumber: pan && PAN.test(pan.toUpperCase()) ? pan.toUpperCase() : undefined,
      passportNumber: str(row.PATIENT_PASSPORT_NUMBER) ?? undefined,
      // Privilege No. ← legacy Membership Number (patient_fields).
      privilegeNumber: fields.membership,
      hasPrivilegeCard: fields.membership ? true : undefined,
      // Emergency contact ← patient_fields EAV rows.
      emergencyContactName: fields.ecName,
      emergencyContactMobileNumber: fields.ecNumber,
    } as CreatePatientDto;

    const branchId = branchByPatient.get(legacyPatientId) || mainBranchId || null;
    const isPlaceholder = mobile.startsWith('EZHT-');
    // Flag known family members up front so a household sharing one mobile is
    // handled deterministically: the anchor (never in memberLegacyIds) keeps the
    // number and stays off the family flag; members are exempt from the unique
    // index. The mobile-conflict retry below remains a safety net for genuinely
    // duplicate PRIMARY registrations that share a number without a family link.
    const isMember = memberLegacyIds.has(legacyPatientId);
    try {
      await prisma.runWithTenant(newTenantId, () =>
        patientService.create(newTenantId, dto, {
          branchId,
          legacyPatientId,
          isFamilyMember: isMember || isPlaceholder ? true : undefined,
        }),
      );
      report.patients.created += 1;
    } catch (e) {
      if (isMobileConflict(e)) {
        // Another active patient already owns this mobile — still import, as a
        // family member (excluded from the unique index), and flag for review.
        try {
          await prisma.runWithTenant(newTenantId, () =>
            patientService.create(newTenantId, dto, {
              branchId,
              legacyPatientId,
              isFamilyMember: true,
            }),
          );
          report.patients.created += 1;
          report.patients.familyBypass.push({ legacyPatientId, mobile });
        } catch (e2) {
          report.patients.errors.push({
            legacyPatientId,
            message: messageOf(e2),
          });
        }
      } else {
        report.patients.errors.push({
          legacyPatientId,
          message: messageOf(e),
        });
      }
    }
  }
  logger.log(
    `  patients: +${report.patients.created}, familyBypass ${report.patients.familyBypass.length}, ` +
      `missingMobile ${report.patients.missingMobile.length}, errors ${report.patients.errors.length}`,
  );
}

/**
 * Reconstruct family relationships from legacy `patient_family`. Both sides
 * already exist as independent Patients — every legacy family member has its own
 * `patientregister` + `user_patient_relation` row, so members came through the
 * patient stage. This stage only re-creates the LINK: one `PatientFamilyLink`
 * (anchor → member, mapped relationship) per active `patient_family` row, plus
 * `isFamilyMember = true` on the member. Idempotent; rows whose member wasn't
 * migrated (no matching Patient) are reported as `unresolved`.
 */
async function migrateFamilyLinks(
  mysql: Connection,
  prisma: PrismaService,
  patientService: PatientService,
  legacyTenantId: number,
  newTenantId: string,
  report: RunReport,
): Promise<void> {
  const [rows] = await mysql.query<LegacyRow[]>(
    `SELECT DISTINCT pf.PATIENT_ID AS anchor, pf.FAMILY_MEMBER_PATIENT_ID AS member, pf.RELATION AS relation
       FROM patient_family pf
      WHERE pf.FLAG = 0
        AND pf.FAMILY_MEMBER_PATIENT_ID IS NOT NULL
        AND pf.PATIENT_ID IN (
          SELECT DISTINCT patient_id FROM user_patient_relation WHERE tenant_id = ?
        )`,
    [legacyTenantId],
  );
  if (rows.length === 0) {
    logger.log('No family links for this tenant.');
    return;
  }

  // Resolve every legacy id involved → new Patient id in one round-trip.
  const legacyIds = new Set<number>();
  for (const r of rows) {
    const a = intOrNull(r.anchor);
    const m = intOrNull(r.member);
    if (a !== null) legacyIds.add(a);
    if (m !== null) legacyIds.add(m);
  }
  const [patients, existingLinks] = await prisma.runWithTenant(newTenantId, () =>
    Promise.all([
      prisma.patient.findMany({
        where: {
          tenantId: newTenantId,
          deletedAt: null,
          legacyPatientId: { in: [...legacyIds] },
        },
        select: { id: true, legacyPatientId: true },
      }),
      prisma.patientFamilyLink.findMany({
        where: { tenantId: newTenantId, deletedAt: null },
        select: { patientId: true, memberId: true },
      }),
    ]),
  );
  const idByLegacy = new Map<number, string>();
  for (const p of patients) {
    if (p.legacyPatientId !== null) idByLegacy.set(p.legacyPatientId, p.id);
  }
  const linkKey = (a: string, m: string): string => `${a}|${m}`;
  const existing = new Set(existingLinks.map((l) => linkKey(l.patientId, l.memberId)));

  for (const r of rows) {
    const anchorLegacyId = intOrNull(r.anchor);
    const memberLegacyId = intOrNull(r.member);
    if (anchorLegacyId === null || memberLegacyId === null) continue;
    const anchorId = idByLegacy.get(anchorLegacyId);
    const memberId = idByLegacy.get(memberLegacyId);
    if (!anchorId || !memberId) {
      report.family.unresolved.push({ anchorLegacyId, memberLegacyId });
      continue;
    }
    if (existing.has(linkKey(anchorId, memberId))) {
      report.family.skipped += 1;
      continue;
    }
    try {
      await prisma.runWithTenant(newTenantId, () =>
        patientService.linkExistingFamilyMember(
          newTenantId,
          anchorId,
          memberId,
          mapRelationship(r.relation),
          {},
        ),
      );
      existing.add(linkKey(anchorId, memberId));
      report.family.created += 1;
    } catch (e) {
      report.family.errors.push({
        anchorLegacyId,
        memberLegacyId,
        message: messageOf(e),
      });
    }
  }
  logger.log(
    `  family: +${report.family.created}, skip ${report.family.skipped}, ` +
      `unresolved ${report.family.unresolved.length}, errors ${report.family.errors.length}`,
  );
}

/**
 * Migrate business-level referring_panels (parent_id = 0) → ReferralPanel,
 * BRANCH-SCOPED. A legacy panel is associated with the branches it has
 * commission/pricing rows for in `referring_panel_price_detail` (branch_id). We
 * create one `ReferralPanel` PER associated (migrated) branch, with `branchId`
 * set; a panel with no branch mapping becomes a single tenant-level row
 * (`branchId = null`). Idempotency is keyed on (legacyId, branchId).
 */
async function migratePanels(
  mysql: Connection,
  prisma: PrismaService,
  referralPanelService: ReferralPanelService,
  legacyTenantId: number,
  newTenantId: string,
  branchMap: Map<number, string>,
  report: RunReport,
): Promise<void> {
  const [rows] = await mysql.query<LegacyRow[]>(
    'SELECT * FROM referring_panels WHERE tenant_id = ? AND (parent_id = 0 OR parent_id IS NULL) ORDER BY id',
    [legacyTenantId],
  );
  if (rows.length === 0) {
    logger.log('No business-level referring panels for this tenant.');
    return;
  }

  // Panel → set of legacy branch ids it's associated with (the branch link lives
  // in referring_panel_price_detail, NOT on the panel row itself).
  const [mapRows] = await mysql.query<LegacyRow[]>(
    'SELECT DISTINCT referring_panel_id AS panel, branch_id AS branch FROM referring_panel_price_detail WHERE tenant_id = ? AND branch_id > 0',
    [legacyTenantId],
  );
  const branchesByPanel = new Map<number, Set<number>>();
  for (const m of mapRows) {
    const panel = intOrNull(m.panel);
    const branch = intOrNull(m.branch);
    if (panel === null || branch === null) continue;
    if (!branchesByPanel.has(panel)) branchesByPanel.set(panel, new Set());
    branchesByPanel.get(panel)!.add(branch);
  }

  // Panel country/state/city may be numeric geo ids — resolve to names.
  const geoIds = (v: unknown): number[] => {
    const n = intOrNull(v);
    return n !== null && n > 0 ? [n] : [];
  };
  const pCountry = await loadGeoNames(mysql, 'country_table', 'COUNTRY_ID', 'COUNTRY_NAME', rows.flatMap((r) => geoIds(r.country)));
  const pState = await loadGeoNames(mysql, 'state_table', 'STATE_ID', 'STATE_NAME', rows.flatMap((r) => geoIds(r.state)));
  const pCity = await loadGeoNames(mysql, 'city_table', 'CITY_ID', 'CITY_NAME', rows.flatMap((r) => geoIds(r.city)));

  // Existing migrated panels, keyed on (legacyId, branchId) for idempotency.
  const done = await prisma.runWithTenant(newTenantId, () =>
    prisma.referralPanel.findMany({
      where: { tenantId: newTenantId, deletedAt: null, legacyId: { not: null } },
      select: { legacyId: true, branchId: true },
    }),
  );
  const key = (legacyId: number, branchId: string | null): string =>
    `${legacyId}|${branchId ?? 'TENANT'}`;
  const doneSet = new Set(done.map((p) => key(p.legacyId!, p.branchId)));

  for (const rp of rows) {
    const legacyId = intOrNull(rp.id);
    if (legacyId === null) continue;
    const name = str(rp.name) ?? `Panel ${legacyId}`;
    const panelType = (str(rp.panel_type) ?? '').toLowerCase();
    const clientType =
      panelType === 'credit' ? ReferralClientType.POSTPAID : ReferralClientType.CASH;

    // Director details — prefer the explicit director_* columns, then fall back
    // to the panel's primary contact / phone-email JSON arrays.
    const directorMobile =
      str(rp.director_contact) ??
      str(rp.primary_mobile_number) ??
      firstFromJsonArray(rp.phone, 'num') ??
      undefined;
    const emailCandidate =
      (str(rp.director_email) && EMAIL.test(str(rp.director_email)!)
        ? str(rp.director_email)
        : null) ??
      (str(rp.primary_email) && EMAIL.test(str(rp.primary_email)!)
        ? str(rp.primary_email)
        : null) ??
      firstFromJsonArray(rp.email, 'email');
    const directorEmail = emailCandidate ?? undefined;

    // Commission/credit config is intentionally left unconfigured here (advanced
    // referral settings are out of scope for the first pass); the legacy values
    // are preserved in `remarks` for later manual setup.
    const remarks = [
      `Migrated from EzHealthTrack (referring_panels.id=${legacyId}).`,
      `panel_type=${str(rp.panel_type) ?? '-'}`,
      `commission_type=${str(rp.commission_type) ?? '-'}`,
      `commission_current=${str(rp.commission_current) ?? '-'}`,
      `credit_limit=${str(rp.credit_limit) ?? '-'}`,
    ].join(' ');

    // Resolve the target branches: legacy branch ids (from price_detail) that map
    // to a migrated branch. No mapping ⇒ a single tenant-level panel.
    const legacyBranches = [...(branchesByPanel.get(legacyId) ?? new Set())];
    const targetBranchIds: Array<string | null> = legacyBranches
      .map((lb) => branchMap.get(lb) ?? null)
      .filter((b): b is string => b !== null);
    if (targetBranchIds.length === 0) targetBranchIds.push(null); // tenant-level

    for (const branchId of targetBranchIds) {
      if (doneSet.has(key(legacyId, branchId))) {
        report.panels.skipped += 1;
        continue;
      }
      const dto: CreateReferralPanelDto = {
        name,
        clientType,
        branchId: branchId ?? undefined,
        panelCode: str(rp.code) ?? undefined,
        addressLine1: str(rp.address) ?? undefined,
        country: resolveGeoValue(rp.country, pCountry),
        city: resolveGeoValue(rp.city, pCity),
        state: resolveGeoValue(rp.state, pState),
        pincode: str(rp.zip) ?? undefined,
        directorName: str(rp.director_name) ?? undefined,
        directorMobile,
        directorEmail,
        remarks,
      } as CreateReferralPanelDto;

      try {
        await prisma.runWithTenant(newTenantId, () =>
          referralPanelService.create(newTenantId, branchId, null, dto, {
            legacyId,
          }),
        );
        doneSet.add(key(legacyId, branchId));
        report.panels.created += 1;
        logger.log(
          `  panel ← legacy ${legacyId} ("${name}") branch=${branchId ?? 'TENANT-LEVEL'}`,
        );
      } catch (e) {
        report.panels.errors.push({ legacyId, message: messageOf(e) });
      }
    }
  }
  logger.log(
    `  panels: +${report.panels.created}, skip ${report.panels.skipped}, errors ${report.panels.errors.length}`,
  );
}

// ── misc utilities ──────────────────────────────────────────────────────────────
function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
function isMobileConflict(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'errorCode' in e &&
    (e as { errorCode?: unknown }).errorCode === 'PATIENT_MOBILE_CONFLICT'
  );
}
function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
function writeReport(report: RunReport): void {
  const dir = join(__dirname, 'out');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `ezht-migration-report.${report.legacyTenantId}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2), 'utf8');
  logger.log(`Report written to ${file}`);
}

main().catch((e) => {
  logger.error(messageOf(e), e instanceof Error ? e.stack : undefined);
  process.exit(1);
});
