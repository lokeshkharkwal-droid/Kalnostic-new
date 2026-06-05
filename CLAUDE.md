# CLAUDE.md — AI Working Memory

> This file is the single source of truth for how we build **Kalnostics New**.
> Read it before writing any code. If a rule here conflicts with something you
> see elsewhere, **this file wins** — and flag the conflict.

---

## 1. Project Overview

| Item            | Value                                             |
| --------------- | ------------------------------------------------- |
| **Project name** | Kalnostics New                                   |
| **Type**         | LMS (Laboratory Management System) backend         |
| **Runtime**      | Node.js (LTS)                                     |

### Tech Stack

- **NestJS** — application framework (modules, controllers, services, DI)
- **Prisma ORM** — database access layer (the *only* way we touch the DB)
- **PostgreSQL** — relational database
- **TypeScript** — `strict` mode is **on** and non-negotiable

> ⚠️ TypeScript strict mode means: no implicit `any`, strict null checks,
> no unchecked index access. Type everything. If you reach for `any`, stop
> and find the real type.

---

## 2. Code Style Rules

These are hard rules. "No exceptions" means no exceptions — if you think you
found one, raise it in review instead of breaking the rule silently.

1. **Module layout is fixed.** Every **feature/domain** module follows the same
   shape: `module / controller / service / dto / entity`, plus an `exceptions/`
   folder for that module's typed `KaltrosException`s. (See `SKILL.md` for the
   exact scaffold.) No flat files, no "I'll just put it here for now."
   **Exception — infrastructure modules** (`auth`, `siteadmin`, `permissions`,
   `prisma`, `security`, and `common`) may add the extra subfolders they
   genuinely need: `guards/`, `strategies/`, `decorators/`, `constants/`,
   `types/`, `services/`. This keeps cross-cutting auth/RBAC code cohesive
   without loosening the rule for ordinary feature modules.

2. **DTOs validate with `class-validator` decorators only.** Never hand-roll
   `if (!body.email) throw ...` validation inside a controller or service.
   The validation pipe + decorators do that job.

3. **Services never import other services directly.** If `CourseService`
   needs `UserService`, wire it through the **module's `imports`/`providers`**
   and inject it via the constructor. Never `import { UserService }` and `new`
   it, and never reach across modules with a direct file import.

4. **No raw SQL.** Use the Prisma client for everything. No
   `prisma.$queryRaw`, no string-built queries. The **one sanctioned
   exception** is Row-Level Security setup (setting the tenant session
   variable and creating policies) — see §4.3. Anything else: raise it for
   discussion before writing raw SQL.

5. **Every public method has a JSDoc comment.** Explain *what* it does, its
   params, and what it returns/throws. Private helpers are encouraged to have
   them too, but public is mandatory.

6. **Errors use the `KaltrosException` pattern** (adopted from kaltros-master).
   All app errors extend a base `KaltrosException` (which itself extends NestJS
   `HttpException`) and carry: a machine-readable `errorCode`
   (`SCREAMING_SNAKE_CASE`), a human-readable `message`, an HTTP status, and a
   `context` object that is **logged server-side but never returned to the
   client**. Each module defines its own typed exceptions (e.g.
   `TenantNotFoundException`, `InvalidCredentialsException`). Never
   `throw new Error('...')` in a request path. (See §4/§5; template in
   `SKILL.md`.)

7. **All responses use the `meta`-based envelope** (adopted from kaltros-master).
   A global `ResponseInterceptor` wraps every success as
   `{ success: true, data, meta: { timestamp, … } }`. Paginated controller
   returns (`{ data, total, page, limit }`) are reshaped so pagination info
   lands in `meta` (with `totalPages`). Error responses use the
   `KaltrosException` envelope `{ success: false, error: { code, message } }`.
   Controllers return raw data/DTOs — the interceptor builds the envelope.

8. **Every business feature is tenant-scoped — and branch-scoped when it
   belongs to a location.** This is the architecture, not an option. New domain
   models default to carrying `tenantId` (+ an RLS policy); models that
   represent something happening *at a branch* also carry a nullable `branchId`.
   Platform-level (no `tenantId`) is the rare exception and must be justified.
   Services **always** filter by `tenantId` (and `branchId` where applicable)
   plus `deletedAt`; the tenant and active branch come from the JWT, **never**
   from client-supplied IDs. Full rules in §4.5–§4.7; step-by-step in `SKILL.md`.

---

## 3. Naming Conventions

| Thing                | Convention            | Example                       |
| -------------------- | --------------------- | ----------------------------- |
| **Files**            | `kebab-case`          | `user-profile.service.ts`     |
| **Classes**          | `PascalCase`          | `UserProfileService`          |
| **Variables / fns**  | `camelCase`           | `findActiveUsers`             |
| **Database tables**  | `snake_case`, plural  | `user_profiles`               |
| **Prisma models**    | `PascalCase`, singular | `UserProfile`                |

> Prisma model → table mapping is done with `@@map("user_profiles")` and
> field mapping with `@map("created_at")`. See the Prisma template in
> `SKILL.md`. This lets us keep idiomatic Prisma model names *and* idiomatic
> SQL table names at the same time.

---

## 4. Persistence, Multi-Tenancy & Multi-Branch Architecture

Adopted wholesale from **kaltros-master** (our reference implementation). These
are binding — the goal is to mirror its multi-tenant **and multi-branch** model
on a Prisma stack. Every feature is built inside this model, not bolted onto it.

### 4.1 ORM, IDs & soft delete

- **Prisma is the only DB layer.** Services call the Prisma client **directly**
  via `PrismaService`. There is **no repository layer** — the reference
  project's `*.repository.ts` classes are intentionally NOT ported (per
  `SKILL.md`).
- **Primary keys: Prisma-default `String @id @default(uuid())` (UUID v4).**
  We do *not* use UUID v7 (the reference project did; we simplified).
- **Soft delete: a plain nullable `deletedAt`** on every model (NULL = active).
  We do *not* port the reference project's archive tier (`archivedAt` /
  `archivedBy` / `archiveReason`).
- `createdAt` / `updatedAt` on every model. `createdBy` / `updatedBy` are
  optional — add them when a feature needs an actor trail.
- Tables `snake_case` plural, columns `snake_case` (via `@@map` / `@map`).

### 4.2 Two model tiers (mirror kaltros-master)

- **Tenant-scoped models** carry a `tenantId` column (`@map("tenant_id")`).
  This is the default for all business/clinical data.
- **Platform-level models** have **no `tenantId`** — they sit above tenants:
  `tenants`, `persons`, `person_credentials`, `siteadmin_users`,
  `refresh_tokens`. Person records instead use **`owner_tenant_id`**: the first
  business to register a person owns their basic details; `NULL` = a
  self-registered patient that any business may update.

### 4.3 Tenant isolation = PostgreSQL Row-Level Security (RLS)

- Replicated exactly from the reference project: every tenant-scoped table has
  an **RLS policy keyed on `tenant_id`**. Per request, the app sets the current
  tenant as a Postgres session variable (e.g. `app.current_tenant_id`) inside a
  transaction; the database enforces isolation.
- **Defence in depth:** services still pass `tenantId` in Prisma `where`
  clauses even though RLS also enforces it.
- This is the **only** sanctioned raw SQL (rule #4): `prisma.$executeRaw` to
  `SET LOCAL app.current_tenant_id = …` and to declare policies in migrations.

### 4.4 Ownership & uniqueness rules (preserve)

- `persons.phone` and `persons.email` are **globally-unique de-duplication
  keys**, locked after first use (only SiteAdmin overrides).
- Only the owning tenant, the person themselves, or **any** tenant for
  self-registered persons (`owner_tenant_id = NULL`) may edit basic details.

### 4.5 Multi-branch scoping (within a tenant)

A tenant runs **multiple branches** (locations). Tenant-scoped business data
splits into two kinds:

- **Tenant-level** — belongs to the business as a whole (e.g. the tenant's
  catalogue, `business_admin` assignment). `branchId` is `NULL`/absent.
- **Branch-level** — happens at one location (e.g. an order, appointment, staff
  assignment). Carries a **nullable `branchId`** (`@map("branch_id")` +
  `@@index([branchId])`) *in addition to* `tenantId`.

Rules:

- A person holds roles via `user_branch_profiles`. A **branch-level** profile
  must be valid for that branch's `branchType` (`PROFILE_BRANCH_MATRIX` in
  `modules/permissions`); **tenant-level** profiles (e.g. `business_admin`,
  `patient`) have `branchId = NULL`.
- The active branch comes from the JWT (`active_branch_id` /
  `active_branch_type`) read via `@CurrentProfile()`. Branch-level reads/writes
  are scoped to it.
- **Never trust a client-supplied `branchId`.** Verify it belongs to the
  caller's tenant first — `BranchService.findById(branchId, tenantId)` (which
  throws if it doesn't).
- Keep `branchId` **nullable** so one model can hold both tenant-level and
  branch-level rows when that genuinely makes sense.

### 4.6 New model — decide the tier first

For **every** new model, answer in order before writing the schema:

1. Does it live **above** any single business (the tenant itself, a
   cross-business identity, platform auth)? → **platform-level** (no
   `tenantId`). Rare — justify it in review.
2. Otherwise it is **tenant-scoped**: add `tenantId` + `@@index([tenantId])`
   **and** an RLS policy in `prisma/rls.sql` (same change).
3. Does a row belong to a **specific location**? → also add a nullable
   `branchId` + `@@index([branchId])`.

> **Default = tenant-scoped, branch-level.** Platform-level and tenant-level
> (no branch) are the exceptions you reach for deliberately.

### 4.7 Scoping rules for services & endpoints

- **Reads:** every query on a tenant-scoped model includes
  `where: { tenantId, deletedAt: null }` (and `branchId` for branch-level
  reads). There is no unscoped `findMany` on business data.
- **Writes:** set `tenantId` (and `branchId`) from the **request context**, not
  from the request body. A tenant/branch id arriving in a body is a red flag —
  validate it against the caller's context.
- **Context source:** `@CurrentTenant()` → `tenantId`; `@CurrentProfile()` →
  active branch/profile. The **only** place that legitimately operates across
  tenants is SiteAdmin tooling, which passes `tenantId` explicitly.
- **Soft delete + atomicity:** filter `deletedAt: null`; delete by setting
  `deletedAt`; wrap multi-step writes in `prisma.$transaction`.

---

## 5. Authentication Architecture

**Two completely separate auth systems**, replicated from kaltros-master.
Preserve the payloads and constants **verbatim** — the frontend depends on them.

### 5.1 Business-user auth (`'jwt'` Passport strategy)

- Access token **15 min**; refresh token **30 days**.
- **Exact JWT payload:** `person_id, tenant_id, active_branch_id,
  active_branch_type, active_profile_key, is_patient_context, profiles[],
  is_patient, platform_mrn, iat?, exp?`. Each `profiles[]` entry:
  `{ branch_id, branch_name, branch_type, profile_key, profile_label,
  is_default }`. The **full profiles array is embedded** so the frontend
  switcher needs no extra call (branch fields are null for tenant-level
  profiles like `business_admin`).
- Global `JwtAuthGuard` protects everything; `@Public()` opts a route out. The
  strategy does **no DB lookup** — the token is self-contained.
- **Refresh tokens:** 64 random bytes, **SHA-256 hashed at rest**, single-use
  rotation, revocable.

### 5.2 SiteAdmin auth (`'jwt-siteadmin'` Passport strategy)

- Access token **8h**; **email-only** login.
- **Exact JWT payload:** `type: 'siteadmin', siteadmin_id, email, role, iat?,
  exp?`. The `type` discriminator means a business token can't be used on
  SiteAdmin routes and vice-versa.
- 4 **cumulative** roles: `content_admin → operations_admin → full_admin →
  super_owner`. `SiteAdminPermissionGuard` validates the token, then AND-checks
  the permissions declared by `@RequireSiteAdminPermission()`.

### 5.3 Shared auth constants (preserve EXACTLY)

- **Lockout:** 10 failed attempts → **15-minute** lock (auto-unlock). Both systems.
- **Password policy:** min 8 chars, ≥1 uppercase, ≥1 digit; **bcrypt cost 12**.
- **Temp password:** 1 upper + 5 lower + 2 digits, excluding `I O 0 1`.
- **`system_username`:** `{ISO2}{3 alpha}-{5 digits}` (e.g. `INABC-12345`),
  letters exclude `I`/`O`.
- **Login identifier precedence:** phone → email → system_username.
- Both strategies share `JWT_SECRET` but use **distinct strategy names**.

---

## 6. Folder Structure (overview)

This is the high-level layout. The detailed per-module scaffold lives in
`SKILL.md` and gets expanded in **Phase 2**.

```
kalnostics-new/
├── prisma/
│   ├── schema.prisma          # Prisma schema (models, datasource, generator)
│   └── migrations/            # generated migration history (committed)
├── src/
│   ├── main.ts                # app bootstrap (global pipes, prefix, etc.)
│   ├── app.module.ts          # root module — imports all feature modules
│   ├── common/                # cross-cutting, shared-by-everyone code
│   │   ├── dto/               # PaginationQueryDto, PaginatedResult
│   │   ├── exceptions/        # KaltrosException + common exceptions
│   │   ├── filters/           # global exception filter (error envelope)
│   │   ├── interceptors/      # ResponseInterceptor (meta envelope)
│   │   └── decorators/ guards/ pipes/ utils/
│   ├── config/                # @nestjs/config setup + Joi validation schema
│   ├── prisma/                # PrismaModule + PrismaService (+ withTenant for RLS)
│   └── modules/               # ⬅️ ALL feature/infra modules live here
│       ├── security/          # PasswordService, UsernameGeneratorService
│       ├── permissions/       # profile registry, branch matrix, catalog, baselines
│       ├── branch/ tenant/ users/        # tenant-scoped + multi-branch features
│       └── auth/ siteadmin/              # the two auth systems
├── prisma/rls.sql             # Row-Level Security policies (tenant-scoped tables)
├── test/                      # e2e tests
├── .env                       # local secrets (NOT committed)
├── .env.example               # documented env template (committed)
├── CLAUDE.md                  # ← you are here
└── SKILL.md                   # reusable patterns & templates
```

> **Phase 2 note:** the `modules/` tree will be filled out feature by feature
> (tenant, users, auth, siteadmin, branches, patients, lab, …) — see the
> migration plan in `MIGRATION-PLAN.md`. Feature modules use the exact scaffold
> from `SKILL.md`; infrastructure modules may add the extra subfolders allowed
> by rule #1.

---

## 7. Git Commit Convention

We use **[Conventional Commits](https://www.conventionalcommits.org/)**.

```
<type>(<optional scope>): <short summary in present tense>
```

**Allowed types:**

| Type       | Use for                                                |
| ---------- | ------------------------------------------------------ |
| `feat`     | a new feature                                          |
| `fix`      | a bug fix                                              |
| `chore`    | tooling, deps, config — no production code change      |
| `docs`     | documentation only                                     |
| `refactor` | code change that neither fixes a bug nor adds a feature |

**Examples**

```
feat(courses): add cursor-based pagination to list endpoint
fix(auth): reject expired JWTs with 401 instead of 500
chore: bump prisma to 5.x
docs: document env vars in .env.example
refactor(users): extract password hashing into a helper
```

Rules of thumb:
- Summary line ≤ ~72 chars, lower-case, no trailing period.
- One logical change per commit.
- Body (optional) explains *why*, not *what* — the diff shows the *what*.

---

## 8. Working Agreement (for the AI)

- Before adding a feature, re-read the **"How to add a new feature"**
  checklist in `SKILL.md` and follow it top to bottom.
- Reuse the templates in `SKILL.md`. Don't invent a second way to do a thing
  that already has a pattern.
- When unsure, prefer the boring, consistent choice over the clever one.
- Keep `CLAUDE.md`, `SKILL.md`, and `MIGRATION-PLAN.md` up to date when
  conventions change.
- **For any new feature, the §4.6 tier decision + §4.7 scoping rules are not
  optional** — they are the first thing to settle, before the schema.

> **Current state:** the tenant, branch, users, auth, and siteadmin modules are
> implemented; the `meta` envelope (§7) and `KaltrosException` (§6) are wired
> globally. Business routes are authenticated (business JWT) but do **not** yet
> enforce per-permission RBAC at the route level — the permission baselines +
> overrides are resolved as data for the frontend and a future business
> permission guard. SiteAdmin routes **do** enforce role/permission via
> `SiteAdminPermissionGuard`. See `docs/api.html` for the full endpoint +
> authorization reference.
