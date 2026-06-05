# MIGRATION-PLAN.md — Porting the kaltros-master tenant/auth architecture into Kalnostics New

> **Goal:** reproduce the multi-tenant + dual-auth architecture of
> `kaltros-master/apps/api` (TypeORM) on the Kalnostics New stack (Prisma),
> preserving all business logic and the **exact** JWT payloads.
> **Status:** planning only — no implementation code yet.
> Read alongside `CLAUDE.md` (§4 persistence, §5 auth) and `SKILL.md`.

---

## 0. Locked decisions

| # | Decision | Effect |
|---|---|---|
| 1 | **Prisma only** (no TypeORM) | All entities → Prisma models; all repositories deleted |
| 2 | **Same multi-tenant architecture** as kaltros-master | Postgres **RLS** + `tenant_id`; platform vs tenant-scoped model tiers; `owner_tenant_id` person ownership |
| 3 | Adopt **`KaltrosException`** coded-error pattern | Replaces "built-in HttpException only"; per-module typed exceptions |
| 4 | Match **`meta`-based** response shape | `{success,data,meta:{…}}`; error `{success:false,error:{code,message}}` |
| 5 | **Services call Prisma directly** | No repository layer (per `SKILL.md`) |
| 6 | **Prisma-default UUID (v4) + plain `deletedAt`** | Drop UUID v7; drop archive tier (`archivedAt`/`archivedBy`/`archiveReason`) |

---

## 1. TypeORM → Prisma translation cheat-sheet

| kaltros-master (TypeORM) | Kalnostics New (Prisma) |
|---|---|
| `@Entity('tenants')` class | `model Tenant { … @@map("tenants") }` |
| `@Column({ name: 'created_at' })` | field with `@map("created_at")` |
| `@PrimaryColumn uuid` + `uuidv7()` `@BeforeInsert` | `id String @id @default(uuid())` (v4) |
| `PlatformEntity` (id, createdAt, updatedAt, deletedAt; **no tenantId**) | base field set on platform models; **no `tenantId`** |
| `BaseEntity` (adds `tenant_id`, archive tier, created/updated_by) | add `tenantId @map("tenant_id")`; **drop archive tier**; `createdBy/updatedBy` optional |
| `@DeleteDateColumn deleted_at` | `deletedAt DateTime? @map("deleted_at")` + `where: { deletedAt: null }` on reads |
| `enum SubscriptionStatus { … }` | Prisma `enum SubscriptionStatus { … }` |
| `@ManyToOne(() => Person) @JoinColumn(...)` | Prisma `relation` (or scalar FK only where the source kept it loose) |
| `*.repository.ts` extends `BaseRepository` | **deleted** — query logic moves into the service via `PrismaService` |
| Query builder / raw SQL (`findAllForTenantRaw`, `revokeAllTokens`) | Prisma `findMany`/`groupBy`/`updateMany` |
| TypeORM migrations | `prisma migrate` + a hand-written raw-SQL migration for **RLS policies** |

---

## 2. Target data model (the 7 in-scope tables)

> All platform models: `id` (uuid v4), `createdAt`, `updatedAt`, `deletedAt?`.
> Tenant-scoped models add `tenantId`. Listed are the key fields/relationships
> to carry over — full field lists come from the source entities.

| Model | Tier | Key fields to preserve | Notes |
|---|---|---|---|
| **Tenant** (`tenants`) | platform | `name, slug (unique, immutable), customDomain?, email?, phone?, address(jsonb), settings(jsonb), subscriptionStatus(enum), subscriptionPlanId?, trialEndsAt?, subscriptionEndsAt?, gracePeriodEndsAt?, isActive, mrnCounter, mrnPrefix?, createdBy?` | "business info" = these fields. `slug` immutable after create |
| **Person** (`persons`) | platform | `platformMrn (unique), salutation?, firstName, lastName?, dateOfBirth?, gender?, bloodGroup?, phone?(unique), email?(unique), address(jsonb), photoUrl?, idType?, idNumber?(encrypted), ownerTenantId?, isPatient, isStaff, isActive` | phone/email = global de-dup keys |
| **PersonCredentials** (`person_credentials`) | platform | `personId (unique), phone?(unique), email?(unique), systemUsername?(unique), isSystemGeneratedUsername, passwordHash, isTempPassword, failedAttempts, lockedUntil?, lastLoginAt?, lastLoginIp?, mfaEnabled, mfaSecret?` | one row per person |
| **UserBranchProfile** (`user_branch_profiles`) | **tenant-scoped** | `tenantId, personId, branchId?(null=tenant-level), profileKey, isDefault, isActive, assignedAt, assignedBy?, revokedAt?, revokedBy?` | revoke = soft (set `revokedAt`/`isActive=false`) |
| **RefreshToken** (`refresh_tokens`) | platform | `personId, tokenHash(unique, sha256), branchId?, profileKey?, issuedToIp?, userAgent?, expiresAt, isUsed, isRevoked` | single-use rotation |
| **SiteAdminUser** (`siteadmin_users`) | platform | `firstName, lastName?, email(unique), passwordHash, role(enum), isActive, failedAttempts, lockedUntil?, lastLoginAt?, lastLoginIp?, createdBy?` | super_owner seeded, never deletable |
| **PersonTenantEnrollment** (`person_tenant_enrollments`) | platform | `personId, tenantId, branchId, tenantMrn?, enrolledAt, enrolledBy?` | **verify canonical source** (patients module) before porting; was `synchronize:false` |

**Enums to port:** `SubscriptionStatus`, `Gender`, `BloodGroup`, `SiteAdminRole`.

**RLS:** every tenant-scoped table (starting with `user_branch_profiles`, then
all future business tables) gets an `ENABLE ROW LEVEL SECURITY` + policy
`USING (tenant_id = current_setting('app.current_tenant_id')::uuid)` written in
a dedicated raw-SQL migration. Platform tables are exempt.

---

## 3. Dependency callout — **branches is in scope by necessity**

`UserBranchProfile.branchId`, the profile/branch-type matrix
(`PROFILE_BRANCH_MATRIX`), and the JWT builder (`branchesService.findById` →
`branch_name`/`branch_type`) all depend on a **branches** module + the
**permissions** constants (`PROFILE_REGISTRY`, `PROFILE_LABELS`,
`PROFILE_PERMISSIONS`, `PERMISSION_CATALOG`). These were not in the original
analysis request but **must be ported (or stubbed) before auth/users compile**.
Treat branches + permissions-constants as a Phase-1 prerequisite.

---

## 4. External integrations & packages to add

| Need | Package | Already installed? |
|---|---|---|
| Password hashing | `bcrypt` (+ `@types/bcrypt`) | ❌ add |
| JWT sign/verify | `@nestjs/jwt` | ✅ |
| Passport strategies | `@nestjs/passport`, `passport`, `passport-jwt` | ✅ |
| Refresh-token hashing / random bytes | `crypto` (Node built-in) | ✅ |
| Domain events (users emits `users.*`) | `@nestjs/event-emitter` | ❌ add (or drop events) |
| Profile photo storage (MinIO/GCS) | storage client | ❌ defer/stub (Phase 4 optional) |
| Audit logging | audit module | ❌ defer (optional, like reference) |
| Env additions | `JWT_SECRET`(have), `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL_DAYS`, `SITEADMIN_TOKEN_TTL`, `BCRYPT_ROUNDS` | extend Joi schema |

---

## 5. Phased execution plan

Each phase is independently reviewable. **Do phases in order** — later phases
import earlier ones.

### Phase 0 — Governance reconciliation *(prerequisite)*
Bring the existing scaffold in line with the new §6/§7 decisions **before**
porting anything:
- Rewrite `src/common/interceptors/response.interceptor.ts` → `meta` envelope
  (`{success,data,meta:{timestamp,…}}`) + paginated reshaping.
- Replace `src/common/filters/http-exception.filter.ts` → render the
  `KaltrosException` envelope `{success:false,error:{code,message}}`; log
  `context` server-side.
- Add `KaltrosException` base + common exceptions in `src/common/exceptions/`.
- Update `SKILL.md` templates (ResponseDto section, error-handling section) to
  match — and add the §4 base-model conventions (uuid v4, `deletedAt`,
  platform vs tenant tiers).
- Resolve the **module-layout open item**: allow `auth`/`siteadmin`/
  `permissions` to carry `guards/ strategies/ decorators/ constants/ types/`
  subfolders, or relocate cross-cutting guards to `src/common/`. Amend
  `CLAUDE.md` §2.1 accordingly.

### Phase 1 — Persistence foundation
- Author Prisma schema for the 7 models + 4 enums (§2), tables/columns mapped.
- `prisma migrate` for the schema.
- Separate raw-SQL migration enabling **RLS** + policies on tenant-scoped tables.
- Extend `PrismaService` with a **tenant-context mechanism**: a request-scoped
  way to `SET LOCAL app.current_tenant_id` inside a transaction (Prisma client
  extension or interactive `$transaction`). Add a `TenantContext`
  middleware/interceptor that reads `tenant_id` from the JWT and sets it.
- Port **branches** + **permissions constants** (Phase-3 dependency, see §3).

### Phase 2 — Shared building blocks
- `PasswordService` (bcrypt cost 12; policy validate; temp-password generator —
  1 upper/5 lower/2 digits excluding I/O/0/1).
- `UsernameGeneratorService` (`{ISO2}{3 alpha}-{5 digits}`, collision retry).
- Confirm exception base + interceptor + filter from Phase 0 are wired globally.

### Phase 3 — Tenant module (+ business info)
- `TenantService`: `create` (atomic via `$transaction`: tenant + admin person +
  credentials + tenant-level `business_admin` profile, returns temp password),
  `findById/findBySlug/findByCustomDomain/findAll`, `update` (slug immutable,
  deep-merge `settings`), `generateNextMrn` (atomic counter), `getBusinessAdmin`,
  `resetBusinessAdminPassword`.
- Preserve every "business rule" comment as behavior.

### Phase 4 — Users module
- `registerPerson`, `updatePersonDetails` (ownership rule exact), `registerStaff`
  (`$transaction`: person + credentials + initial profile; identifier
  precedence), `assignProfile`/`revokeProfile`/`setDefaultProfile` (registry +
  branch-matrix validation; single default), `getProfilePermissions`/
  `setProfilePermissions` (override allow/deny/inherit resolution),
  receptionist↔doctor mapping, `resetStaffPassword`, photo upload (storage —
  optional/stub), `listTenantStaff` (raw join → Prisma relations + grouping).
- Replace `EventEmitter2` events or wire `@nestjs/event-emitter`.

### Phase 5 — Business auth module
- `AuthService`: `login` (lockout-before-password, bcrypt, 10/15-min, tenant
  resolution), `refresh` (sha256 lookup, single-use rotation), `switchProfile`
  (access-only), `changePassword`, `revokeAllTokens` (`updateMany`).
- `buildJwtPayload` producing the **exact** payload (incl. embedded `profiles[]`
  and the owner-tenant fallback heuristic).
- `JwtStrategy` (`'jwt'`), global `JwtAuthGuard`, `@Public()`, `@CurrentUser()`,
  `@CurrentTenant()`, `@CurrentProfile()`.

### Phase 6 — SiteAdmin module
- `SiteAdminService`: `login` (8h `type:'siteadmin'` token), `create`
  (no super_owner via API), `findAll`, `changePassword`, `deactivate`
  (super_owner protected).
- `SiteAdminJwtStrategy` (`'jwt-siteadmin'`), `SiteAdminPermissionGuard`,
  role/permission matrix + `@RequireSiteAdminPermission()`,
  `@CurrentSiteAdmin()`.
- Later (out of core scope): subscription/plan mgmt + master-data catalogs —
  each split into its own feature module rather than one mega-module.

### Phase 7 — Verification
- e2e: business login → token shape → switch-profile → refresh rotation →
  logout; siteadmin login → permission-gated route.
- **RLS isolation test:** tenant A cannot read tenant B's rows even with a bug
  in the `where` clause.
- Confirm `meta` envelope + `KaltrosException` envelope on success/error paths.

---

## 6. Preserve EXACTLY (verbatim)

- **Business JWT payload** and **SiteAdmin JWT payload** — see `CLAUDE.md`
  §5.1 / §5.2.
- **Constants** — see `CLAUDE.md` §5.3 (TTLs, lockout, bcrypt cost, password &
  username formats, identifier precedence).

---

## 7. Open decisions / risks

1. **Module layout vs auth infra subfolders** (Phase 0) — needs a CLAUDE.md §2.1
   amendment. *Recommendation:* permit infra subfolders for `auth`/`siteadmin`/
   `permissions`.
2. **RLS + connection pooling** — `SET LOCAL` must run in the same transaction
   as the queries; with PgBouncer in transaction mode this needs a Prisma
   client extension wrapping queries in `$transaction`. Validate early.
3. **Embedded `profiles[]` token size** — fine for typical staff; could bloat
   for users with many assignments. Accept (matches reference) but note it.
4. **`person_tenant_enrollments` canonical source** — confirm the patients
   module is the owner before porting the legacy entity.
5. **Encryption at rest** (`persons.idNumber`, `mfaSecret`) — reference uses
   AES-256-GCM via config; decide whether to port now or defer.
6. **Events vs direct calls** — adopt `@nestjs/event-emitter` or inline the
   downstream effects; decide before Phase 4.
