---
name: backend-development-guide
description: Official backend development guide for Kalnostics New (NestJS/Prisma). Enforce the feature-module scaffold, service/DTO/exception patterns, multi-tenant + multi-branch RLS, response/error envelopes, auth, and the mandatory Bruno-docs rule whenever creating or modifying backend code (kalnostics-new).
---

# Kalnostics New — Backend Development Guide

> **This is the single entry point for backend work on Kalnostics New.**
> Read it before writing or changing any backend code. It is prescriptive: the
> rules here are how we build, not suggestions.

## 0. Purpose & how to use this skill

**Audience:** any developer (and Claude Code) writing NestJS/Prisma backend code
in this repo. It is written so a junior developer can produce production-ready,
consistent code by following it top to bottom.

**This skill *references and extends* the two governance docs — it does not
replace them.** For rules that already live in the governance docs, this skill
points you to them and adds the *how* and the *file to imitate*. The authority
order is:

1. **`CLAUDE.md`** (workspace root) — the binding rules. **On any conflict,
   `CLAUDE.md` wins — and flag the conflict** so we fix this skill.
2. **`SKILL.md`** (workspace root) — the copy-paste templates (module scaffold,
   Prisma model, service, DTO, exception, envelope, auth, audit) + the
   "How to add a new feature" checklist.
3. **This skill** — the connective guide: architecture overview, the *why*, the
   topics the governance docs don't cover in depth (RLS internals, security,
   performance, testing, Bruno workflow, messaging), and honest notes on what is
   **not** implemented so you don't cargo-cult patterns the codebase doesn't use.

> ⚠️ **Where the code lives.** Claude Code launches in `Master/`, but the backend
> app is in the **`kalnostics-new/`** subfolder. Run **all** `pnpm`, `git`,
> `tsc`, `nest`, and `prisma` commands from `kalnostics-new/` (`CLAUDE.md §0`).

**Canonical reference modules — copy how these do it when a template is
ambiguous:**
- `src/modules/branch/` — tenant-level model with a system-generated sequential
  code, the simplest full module.
- `src/modules/department/` — tenant-level model with nested mappings, counters,
  and SiteAdmin-template/clone controllers.
- `src/modules/lab-test/` — branch-level model nested under master data.

---

## 1. Project architecture & folder structure

The backend is a modular NestJS monolith. Everything hangs off `src/app.module.ts`
(which registers every module + the global guard/interceptors) and boots via
`src/main.ts` (global pipes/filters/interceptors, `api/v1` prefix, helmet, CORS).

```
kalnostics-new/
├── prisma/
│   ├── schema.prisma      # models + enums
│   ├── rls.sql            # RLS policies + partial unique indexes
│   └── seed.ts
├── bruno/                 # API docs collection — UPDATE ON EVERY API CHANGE (§17)
├── docs/api.html          # hand-maintained endpoint reference (keep in sync)
└── src/
    ├── main.ts            # bootstrap: ValidationPipe, HttpExceptionFilter, ResponseInterceptor
    ├── app.module.ts      # imports every module + global APP_GUARD / APP_INTERCEPTORs
    ├── common/            # cross-cutting code shared by everyone (§2,§4,§5)
    ├── config/            # @nestjs/config + Joi env validation
    ├── prisma/            # PrismaService + tenant-context (RLS plumbing, §7)
    └── modules/           # ALL feature + infrastructure modules
```

### Feature module scaffold (fixed — `CLAUDE.md §2` rule 1, template in `SKILL.md §1`)

Every **feature/domain** module has exactly this shape:

```
src/modules/<feature>/
├── <feature>.module.ts       # wires imports / controllers / providers / exports
├── <feature>.controller.ts   # thin — HTTP only
├── <feature>.service.ts      # all business logic
├── dto/                      # class-validator DTOs (create / update / list-query)
├── entities/                 # Prisma type aliases / composed return types
└── exceptions/               # this module's typed KaltrosExceptions
```

Options/SiteAdmin variants live as extra controllers in the same folder
(e.g. `<feature>-options.controller.ts`, `siteadmin-<feature>.controller.ts`) —
list `*-options` controllers **first** in `controllers: []` so their static
routes match before `:id` routes.

### Infrastructure modules

`auth`, `siteadmin`, `permissions`, `security`, `prisma`, `common` may add the
extra subfolders they genuinely need: `guards/`, `strategies/`, `decorators/`,
`constants/`, `types/`, `services/` (`CLAUDE.md §2` rule 1 exception). Ordinary
feature modules must **not** — no flat files, no "I'll just put it here for now."

### Module dependency rule (`CLAUDE.md §2` rule 3)

**Services never import other services directly.** If `DepartmentService` needs
`BranchService`, the module `imports` the other module and the service injects it
via the constructor:

```ts
// department.module.ts
@Module({
  imports: [PrismaModule, BranchModule],   // BranchModule exports BranchService
  controllers: [DepartmentOptionsController, DepartmentController, SiteAdminDepartmentController],
  providers: [DepartmentService],
  exports: [DepartmentService],            // so other modules can inject it
})
export class DepartmentModule {}
```

Never `import { BranchService }` and `new` it, and never reach across modules
with a direct file import.

> ⚠️ **No repository layer.** The reference project's `*.repository.ts` classes
> are intentionally **not** ported. Services call `PrismaService` **directly**.
> Do not add a repository tier.

---

## 2. NestJS coding standards

### Controllers are thin

A controller only: declares the route, extracts request context via decorators,
validates the body via its DTO type, and returns the service result **raw**.
No business logic, no envelope building (the interceptor does that — §5), no
manual validation.

```ts
@Controller('departments')
export class DepartmentController {
  constructor(private readonly departmentService: DepartmentService) {}

  @Post()
  @Audit({ module: AuditModule.DEPARTMENT, action: AuditAction.CREATE, description: 'Created a department' })
  create(@CurrentTenant() tenantId: string, @Body() dto: CreateDepartmentDto) {
    return this.departmentService.create(tenantId, dto);   // raw return
  }

  @Get()
  findAll(@CurrentTenant() tenantId: string, @Query() query: ListDepartmentQueryDto) {
    return this.departmentService.findAllForTenant(tenantId, query.page ?? 1, query.limit ?? 20, { ... });
  }
}
```

### Services hold the logic

- **Every public method has a JSDoc comment** describing what it does, its
  params, and what it returns/throws (`CLAUDE.md §2` rule 5). Private helpers are
  encouraged to have them too.
- Services take context (`tenantId`, active branch/profile) as **parameters**
  from the controller — they never read the request.
- All DB access goes through injected `PrismaService` (§6, §7).

### Custom decorators (use these — do not re-read the request manually)

Defined in `src/modules/auth/decorators/`:
- `@CurrentTenant()` → `tenantId: string` (from JWT `tenant_id`).
- `@CurrentProfile()` → `{ profileKey, branchId }` (active branch/role).
- `@CurrentUser()` / `@CurrentUser('person_id')` → the whole payload or one field.
- `@Public()` → opts a route out of the global `JwtAuthGuard`.

And in `src/common/decorators/`:
- `@Audit({ module, action?, description })` → declarative audit (§15).

### Pipes, guards, interceptors, middleware — global by default

These are wired **once** and apply everywhere; you rarely add new ones:
- **ValidationPipe** (global, `main.ts`): `whitelist`, `forbidNonWhitelisted`,
  `transform`, `enableImplicitConversion` — see §3 for the implicit-conversion
  boolean caveat.
- **JwtAuthGuard** (global `APP_GUARD`, `app.module.ts`): every route is
  protected unless `@Public()`.
- **ResponseInterceptor / HttpExceptionFilter** (global, `main.ts`): envelopes.
- **TenantContextInterceptor / AuditInterceptor** (global `APP_INTERCEPTOR`):
  RLS context (§7) and audit (§15).

### Logging

Use Nest's `Logger` (`new Logger(MyThing.name)`). Server errors (5xx) are already
logged with `KaltrosException.context` by the global filter (§4) — do not log and
re-throw. Never `console.log` in committed code.

---

## 3. DTOs & validation

**class-validator decorators only.** Never hand-roll `if (!body.x) throw ...` in
a controller or service (`CLAUDE.md §2` rule 2). Templates in `SKILL.md §4`.

```ts
export class CreateDepartmentDto {
  @IsString() @MinLength(2) @MaxLength(255)
  name: string;

  @IsString() @Matches(/^[A-Z0-9]{2,6}$/, { message: 'shortName must be 2-6 uppercase letters or digits' })
  shortName: string;

  @IsBoolean() @IsOptional()
  isActive?: boolean;

  @IsArray() @IsEnum(BranchType, { each: true }) @ArrayUnique()
  moduleMapping: BranchType[];

  @IsArray() @IsOptional() @ValidateNested({ each: true }) @Type(() => DepartmentPersonMappingDto)
  personMappings?: DepartmentPersonMappingDto[];
}
```

Rules:
- **Query-param numbers** need `@Type(() => Number)` (they arrive as strings) —
  see `common/dto/pagination-query.dto.ts` (`page`/`limit`, `@Min(1)`,
  `limit @Max(100)`).
- **Nested objects** need `@ValidateNested({ each: true })` + `@Type(() => Dto)`.
- **Update DTOs** use explicit optional fields — **no `PartialType`** (`SKILL.md §4`).
- **Booleans** are prefixed `is`/`has`/`can`/`should` through DTO → model → column
  → API body (`CLAUDE.md §3`).
- **Never send** `tenantId` / `branchId` / system-generated `code` in a body —
  they're rejected as unknown fields (`forbidNonWhitelisted`) and come from
  context anyway (§7).

> ⚠️ **Boolean query-param caveat** (known bug, already fixed). `ValidationPipe`
> `enableImplicitConversion` coerces the string `"false"` → `true` **before**
> a custom `@Transform` runs, so a naive boolean query param is always true. For
> boolean **query params** use the shared `ToBoolean()` transform in
> `src/common/decorators/to-boolean.decorator.ts` (it reads the raw value), e.g.
> `@IsOptional() @ToBoolean() @IsBoolean() isHomeVisit?: boolean;`.

---

## 4. Error handling & exceptions

Never `throw new Error('...')` in a request path (`CLAUDE.md §2` rule 6). All app
errors extend **`KaltrosException`** (`src/common/exceptions/kaltros.exception.ts`),
which carries a machine-readable `errorCode`, a client `message`, an HTTP status,
and a **`context` object logged server-side but never returned to the client**.

```ts
// A module's own typed exceptions live in <feature>/exceptions/<feature>.exceptions.ts
export class DepartmentNotFoundException extends KaltrosException {
  constructor(id: string) {
    super('DEPARTMENT_NOT_FOUND', 'Department not found', { id }, HttpStatus.NOT_FOUND);
  }
}
```

- `errorCode` is `SCREAMING_SNAKE_CASE`.
- Reuse the common exceptions in `src/common/exceptions/` when they fit
  (`NotFoundException`, `ConflictException`, `ValidationException`,
  `UnauthorisedException`, `ForbiddenException`) rather than inventing duplicates.
- The global **`HttpExceptionFilter`** (`src/common/filters/http-exception.filter.ts`,
  wired in `main.ts`) turns everything into the error envelope
  `{ success: false, error: { code, message } }`, logs 5xx + `context`, and wraps
  built-in `HttpException`s (e.g. from `ValidationPipe`).

Template + more detail: `SKILL.md §5`.

---

## 5. Response & pagination envelope

Controllers return **raw data/DTOs**. The global **`ResponseInterceptor`**
(`src/common/interceptors/response.interceptor.ts`) wraps success as:

```jsonc
{ "success": true, "data": <payload>, "meta": { "timestamp": "..." } }
```

**Pagination:** a service returns a plain `{ data, total, page, limit }` object.
The interceptor detects it and lifts the pagination fields into `meta`, computing
`totalPages`:

```jsonc
{ "success": true, "data": [...], "meta": { "total": 42, "page": 1, "limit": 20, "totalPages": 3, "timestamp": "..." } }
```

Prisma `Decimal` values are converted to `number` by the interceptor for clean
JSON. Do not build envelopes by hand anywhere. Template: `SKILL.md §6`.

---

## 6. PostgreSQL & Prisma conventions

**Prisma is the only DB layer** (`CLAUDE.md §4.1`). No `prisma.$queryRaw`, no
string-built SQL — the **one** sanctioned raw-SQL exception is RLS setup (§7).

### Model conventions (`CLAUDE.md §3`, §4.1; template `SKILL.md §2`)

- **Names:** Prisma model `PascalCase` singular; table `snake_case` plural via
  `@@map`; columns `snake_case` via `@map`.
- **Primary key:** `String @id @default(uuid())` (UUID v4 — **not** v7).
- **Soft delete:** nullable `deletedAt` (`@map("deleted_at")`), `NULL` = active.
  No archive tier.
- **Timestamps:** `createdAt @default(now())` + `updatedAt @updatedAt` on every
  model. Add `createdBy`/`updatedBy` only when a feature needs an actor trail.
- **Booleans:** `is`/`has`/`can`/`should` prefix on field **and** column, e.g.
  `isActive @map("is_active")`.
- **Indexes:** `@@index([tenantId])`, `@@index([branchId])` (branch-level),
  `@@index([deletedAt])`, plus any FK/lookup columns.

```prisma
model Branch {
  id         String       @id @default(uuid())
  tenantId   String       @map("tenant_id")
  name       String
  branchType BranchType   @map("branch_type")
  code       String       // system-generated, immutable (BR-00001)
  status     BranchStatus @default(ACTIVE)
  createdAt  DateTime     @default(now()) @map("created_at")
  updatedAt  DateTime     @updatedAt @map("updated_at")
  deletedAt  DateTime?    @map("deleted_at")

  @@index([tenantId])
  @@index([deletedAt])
  @@map("branches")
}
```

### System-generated sequential codes

Codes like `BR-00001` / `{INITIALS}-Dep-{n}` come from a per-tenant counter on
`Tenant` (e.g. `branchCounter`, `departmentCounter`) incremented **atomically in
the same transaction** as the insert. Copy `department.service.ts` `create()`:
`prisma.withTenant(tenantId, tx => { tx.tenant.update({ ..increment.. }); ... })`.

### Transactions

Wrap any multi-step write in a transaction. For tenant-scoped writes use
`prisma.withTenant(tenantId, async (tx) => ...)` (sets RLS context too — §7).

### Partial unique indexes

Prisma cannot express `UNIQUE ... WHERE deleted_at IS NULL`. Declare these in
`prisma/rls.sql` alongside the policies (e.g.
`branches_tenant_code_active_unique`). A soft-deleted row must not block a new
active one from reusing a name/code.

### Migrations (Windows / this repo)

- Dev uses **`prisma db push`** — `prisma migrate dev` is blocked here (drift).
- **Stop running node processes before `prisma generate`** (Windows DLL lock).
- After schema changes, re-apply `prisma/rls.sql` (see §7 gotcha).

---

## 7. Multi-tenancy, multi-branch & Row-Level Security (deep dive)

This is the architecture, not an option (`CLAUDE.md §4.2–§4.7`). Every business
feature is **tenant-scoped**, and **branch-scoped** when it happens at a location.

### 7.1 Decide the tier FIRST (before the schema — `CLAUDE.md §4.6`)

1. Does it live **above** any single business (the tenant itself, cross-business
   identity, platform auth)? → **platform-level**, no `tenantId`. Rare — justify
   it. Examples: `Tenant`, `Person`, `SiteAdminUser`, refresh tokens.
2. Otherwise **tenant-scoped**: add `tenantId` + `@@index([tenantId])` **and** an
   RLS policy in `prisma/rls.sql` (same change).
3. Does a row belong to a **specific location**? → also add nullable `branchId`
   + `@@index([branchId])`.

> **Default = tenant-scoped, branch-level.** Keep `branchId` **nullable** so one
> model can hold tenant-level rows (`branchId = NULL`, e.g. `business_admin`) and
> branch-level rows together.

### 7.2 Scoping rules for services (`CLAUDE.md §4.7`)

- **Reads:** every query on a tenant-scoped model includes
  `where: { tenantId, deletedAt: null }` (and `branchId` for branch-level reads).
  There is no unscoped `findMany` on business data.
- **Writes:** set `tenantId` (and `branchId`) from **request context**, never
  from the body. A tenant/branch id in a body is a red flag.
- **Never trust a client `branchId`.** Verify it belongs to the caller's tenant
  first via `BranchService.findById(branchId, tenantId)` (throws otherwise).
- **Context source:** `@CurrentTenant()` → `tenantId`; `@CurrentProfile()` →
  active branch/profile. The only cross-tenant caller is SiteAdmin tooling, which
  passes `tenantId` explicitly.
- **Soft delete:** filter `deletedAt: null`; "delete" = set `deletedAt`; wrap
  multi-step writes in a transaction.

### 7.3 How RLS actually works (defence in depth)

Even though services pass `tenantId` in `where`, the **database** also enforces
isolation via PostgreSQL Row-Level Security:

- `src/prisma/prisma.service.ts` — when `RLS_ENABLED=true`, a `$extends` wraps
  every model op in a transaction that first runs
  `SELECT set_config('app.current_tenant_id', <tenantId>, true)`. The tenant id
  comes from `AsyncLocalStorage`.
- `src/prisma/tenant-context.ts` — the `AsyncLocalStorage` store (`tenantId`,
  `rlsTxActive`).
- `src/common/interceptors/tenant-context.interceptor.ts` — runs after the JWT
  guard, reads `req.user.tenant_id`, and runs the handler inside
  `tenantContext.run(...)` so all async DB work sees the tenant.
- `PrismaService.withTenant(tenantId, tx => ...)` — for **transactional writes**:
  sets the GUC and marks `rlsTxActive` so the extension doesn't double-wrap.
- `PrismaService.runWithTenant(tenantId, () => ...)` — for SiteAdmin cross-tenant
  reads that delegate into tenant services.
- `prisma/rls.sql` — per-table policies keyed on `current_tenant_id()`:

```sql
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE branches FORCE ROW LEVEL SECURITY;
CREATE POLICY branches_tenant_isolation ON branches
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
```

Some tables allow NULL-tenant system rows (e.g. `auth_roles`, SiteAdmin lab
templates) with `USING (tenant_id = current_tenant_id() OR tenant_id IS NULL)`.

> ⚠️ **`rls.sql` gotcha.** The script can halt on a dropped table (historically
> `radiologists`). Apply new policies individually, or run without
> `ON_ERROR_STOP`. One-off data migrations on the dev DB (RLS on) must set
> `app.current_tenant_id` per tenant (use the `withTenant` pattern).

### 7.4 Common mistakes to avoid

- `findMany` / `update` / `delete` without `tenantId` (+ `branchId`) and
  `deletedAt: null`.
- Taking `tenantId`/`branchId` from the request body.
- Hard-deleting instead of setting `deletedAt`.
- Trusting a client `branchId` without `BranchService.findById`.
- Assuming RLS alone is enough and dropping the `where` filter — keep both.
- Forgetting to add the RLS policy + partial unique index when adding a
  tenant-scoped model.

---

## 8. Authentication & authorization

**Two completely separate auth systems** (`CLAUDE.md §5`; template `SKILL.md §8`).
Preserve the JWT payloads and constants **verbatim** — the frontend depends on them.

### 8.1 Business-user auth (`'jwt'` strategy)

- `src/modules/auth/` — access token **15 min**, refresh **30 days** (64 random
  bytes, SHA-256 hashed at rest, single-use rotation).
- Global **`JwtAuthGuard`** (`APP_GUARD`) protects everything; **`@Public()`**
  opts out. The strategy does **no DB lookup** — the token is self-contained.
- Exact payload (`src/modules/auth/types/jwt-payload.type.ts`): `person_id`,
  `tenant_id`, `active_branch_id`, `active_branch_type`, `active_profile_key`,
  `is_patient_context`, `profiles[]`, `is_patient`, `platform_mrn`. The full
  `profiles[]` array is embedded so the FE switcher needs no extra call.

### 8.2 SiteAdmin auth (`'jwt-siteadmin'` strategy)

- `src/modules/siteadmin/` — access token **8h**, email-only login. Payload:
  `type: 'siteadmin'`, `siteadmin_id`, `email`, `role`. The `type` discriminator
  prevents a business token from working on SiteAdmin routes and vice-versa.
- **`SiteAdminPermissionGuard`** validates the token, then AND-checks the
  permissions from **`@RequireSiteAdminPermission()`**. 4 cumulative roles:
  `content_admin → operations_admin → full_admin → super_owner`.

### 8.3 Shared constants (preserve exactly — `CLAUDE.md §5.3`)

Lockout 10 fails → 15-min lock; password min 8 / ≥1 upper / ≥1 digit / bcrypt
cost 12; temp password `1 upper + 5 lower + 2 digits` excluding `I O 0 1`;
`system_username` `{ISO2}{3 alpha}-{5 digits}` (no `I`/`O`); login precedence
phone → email → system_username. Both strategies share `JWT_SECRET` but use
distinct strategy names. Password/username logic lives in `modules/security`.

> ⚠️ **Business RBAC is not yet enforced at the route level.** Business routes
> are authenticated (business JWT) but do not yet enforce per-permission RBAC —
> permission baselines + overrides are resolved as **data** for the frontend and
> a future business permission guard. Only **SiteAdmin** routes enforce
> role/permission today. Don't assume a business route is permission-gated.

---

## 9. API development standards

- **REST**, resource-oriented. Routes are **plural kebab-case** nouns under the
  global **`api/v1`** prefix (set in `main.ts`): `/api/v1/departments`,
  `/api/v1/lab-tests`.
- **HTTP methods:** `GET` read, `POST` create, `PATCH` partial update, `PUT` full
  replace, `DELETE` soft-delete. Match the verbs the existing modules use.
- **Dropdown/lookup data** goes through a dedicated `*-options.controller.ts`
  (branch-scoped from JWT), not overloaded list endpoints.
- **Success & error** always use the envelopes from §5 / §4 — never a bare array
  or object, never a custom error shape.
- **List endpoints** accept a `List<Feature>QueryDto` with `page`/`limit`
  (pagination §5), plus `search`, status, and domain filters as validated
  optional fields; sorting/filtering happens in the service `where`/`orderBy`.

> ⚠️ **API versioning:** only the static `api/v1` **global prefix** exists — there
> is no per-route NestJS versioning (`@Version`) and no `v2`. Don't invent a
> versioning scheme; if one is needed, raise it first.

---

## 10. Business logic placement

- **All business logic lives in the service.** Controllers stay thin (§2);
  DTOs validate; the service orchestrates Prisma + injected services.
- **Cross-cutting, shared-by-everyone code** goes in `src/common/`
  (interceptors, filters, decorators, dtos, utils, validators). Reusable
  domain logic is **exported from its module** and injected elsewhere (§1) —
  never duplicated. If you're about to copy a block, extract/inject instead
  (DRY, `CLAUDE.md §8`).
- Utility helpers with no state (e.g. `common/utils/client-ip.util.ts`) are plain
  functions, not services.

---

## 11. Security best practices

- **SQL injection:** avoided by Prisma parameterization. No string-built queries;
  no raw SQL except RLS setup (§6, §7).
- **Input:** global `ValidationPipe` with `whitelist` + `forbidNonWhitelisted`
  strips/rejects unknown fields — this is the sanitization layer. Keep DTOs tight.
- **Headers/transport:** `helmet` + `compression` + an explicit CORS allowlist are
  configured in `main.ts` (`CORS_ORIGIN` env). Don't disable them.
- **Secrets:** all config comes via `@nestjs/config` + Joi
  (`src/config/env.validation.ts`); `.env` is never committed. `JWT_SECRET` min
  32 chars; `ENCRYPTION_KEY` is an optional 64-hex AES-256-GCM key.
- **Sensitive data:** passwords bcrypt cost 12; refresh tokens SHA-256 hashed at
  rest; `KaltrosException.context` is logged server-side, **never** returned.

> ⚠️ **Not implemented:** no rate limiting (`@nestjs/throttler` is absent) and no
> CSRF middleware (the API uses bearer tokens, not cookies, so CSRF is low-risk).
> Treat both as future work — do not fake a config that isn't wired.

---

## 12. Performance guidelines

- **Select narrowly:** use Prisma `select`/`include` to fetch only needed fields
  and relations.
- **Prevent N+1:** load relations with a single `include`/nested `select`; never
  loop and query per row.
- **Index** `tenantId` / `branchId` / `deletedAt` and lookup columns (§6) — RLS
  filters on `tenant_id` on every query, so it must be indexed.
- **Pagination:** offset-based `page`/`limit` with `limit` capped at 100
  (`PaginationQueryDto`); always paginate list endpoints.
- **Batch** multi-step writes in `$transaction` / `withTenant` rather than many
  round-trips.

> ⚠️ **Not implemented:** there is no caching / Redis layer. Don't introduce one
> without an explicit decision.

---

## 13. Messaging, jobs & events

The only async mechanisms wired today (`app.module.ts`):
- **`EventEmitterModule`** (`@nestjs/event-emitter`) — in-process domain events
  (`eventEmitter.emit(...)` / `@OnEvent(...)`), e.g. `BranchService`.
- **`ScheduleModule`** (`@nestjs/schedule`) — cron/scheduled work via `@Cron`.

> ⚠️ **Not implemented:** no external message queue or broker (no Bull/BullMQ,
> Redis, Kafka, RabbitMQ), so there is no durable retry/dead-letter infrastructure.
> "Events vs direct calls" is still an **open decision** (see `MIGRATION-PLAN.md`)
> — **prefer direct injected-service calls** for cross-module work unless told
> otherwise; use in-process events only for genuine fire-and-forget side effects.

---

## 14. Testing standards

Jest is configured (config inline in `package.json`): unit specs are `*.spec.ts`
under `src/`; e2e specs are `*.e2e-spec.ts` under `test/` (`pnpm test`,
`pnpm test:cov`, `pnpm test:e2e`).

Two real patterns to copy:
- **Mocked-provider unit test** — `src/modules/auth/auth.service.spec.ts`: mock
  `PrismaService`/`JwtService`/injected services, assert service logic in
  isolation.
- **Real-DB e2e** — `test/slot-reservation.e2e-spec.ts`: boot `AppModule`, use
  `prisma.withTenant(...)` for RLS isolation, assert behaviour (incl. concurrency
  with `Promise.allSettled`). Needs a reachable PostgreSQL.

> ⚠️ **Coverage is currently light** (≈2 real suites) and there is **no enforced
> coverage threshold**. Add tests for new **non-trivial** logic (tricky business
> rules, concurrency, scoping). Never claim a suite exists that doesn't, and
> don't `describe.skip` and call it done.

---

## 15. Logging, monitoring & audit

- **Server errors:** the global `HttpExceptionFilter` logs 5xx with the
  `KaltrosException.context` via Nest `Logger` (§4). Don't duplicate that logging.
- **Audit trail (declarative):** annotate **mutating** routes with
  `@Audit({ module: AuditModule.X, action: AuditAction.CREATE, description })`
  (`src/common/decorators/audit.decorator.ts`). The global **`AuditInterceptor`**
  (`src/common/interceptors/audit.interceptor.ts`) writes an `AuditLog` row
  **after** the handler succeeds, capturing tenant, active branch, actor person,
  role key/label (from the JWT `profiles[]`), and client IP. It **skips** routes
  with no `@Audit` and requests with no authenticated business user. Template:
  `SKILL.md §9`. Read API: the `audit` module.

> There is no separate APM/metrics stack — audit logs + Nest logging are the
> observability surface today.

---

## 16. Code quality standards

- **TypeScript strict is non-negotiable** (`CLAUDE.md §1`): `strict: true` +
  `noUncheckedIndexedAccess`; `strictPropertyInitialization: false` only because
  class-validator hydrates DTO fields. No implicit `any` — ESLint forbids explicit
  `any` too. If you reach for `any`, find the real type.
- **Naming** (`CLAUDE.md §3`): files `kebab-case`, classes `PascalCase`,
  vars/fns `camelCase`, tables `snake_case` plural, Prisma models `PascalCase`
  singular, booleans `is/has/can/should`.
- **Clean code:** thin controllers, focused services, small functions, DRY, KISS.
  Prefer the boring consistent choice over the clever one.
- **Commits:** Conventional Commits (`CLAUDE.md §7`), e.g.
  `feat(department): add person-mapping endpoint`. One logical change per commit.
- **Before committing, run the gate from `kalnostics-new/`:**

  ```bash
  pnpm validate      # = pnpm type-check && pnpm lint && pnpm format:check
  ```

  (`/check` runs this for you.) It must pass clean.

---

## 17. Bruno documentation — MANDATORY on every API change

> **Whenever you add or change an API, you MUST create/update its Bruno request.**
> This is a hard project rule. Also keep `kalnostics-new/docs/api.html` in sync.

The collection lives at `kalnostics-new/bruno/`, organized into numbered folders
by module (`04 Business Auth`, `05 Branches`, `06 Users`, …). Config:
`bruno/bruno.json`; environment vars (incl. `baseUrl`, tokens, seed test data):
`bruno/environments/Local.bru`.

Add/update a `.bru` request with this anatomy (see `bruno/05 Branches/Create
Branch.bru` for a full example):

```
meta   { name: Create Branch, type: http, seq: 1 }
post   { url: {{baseUrl}}/branches, body: json, auth: bearer }
headers { Content-Type: application/json }
auth:bearer { token: {{businessAccessToken}} }        # or {{siteAdminToken}} for SiteAdmin routes; none for @Public
body:json { { "name": "...", "branchType": "DIAGNOSTIC" } }
vars:pre-request { ... }                                # local overridable defaults shown in UI
script:post-response {                                  # chain IDs for downstream requests
  const data = res.getBody() && res.getBody().data;
  if (data && data.id) bru.setEnvVar("branchId", data.id);
}
docs { ...full field-by-field description, required/optional, validation, error codes,
       and notes like "code is system-generated — do NOT send it"... }
```

Checklist when documenting an endpoint:
1. Put the `.bru` in the correct `NN <Module>` folder (create the folder + its
   `folder.bru` if new).
2. Use the right auth token env var (business vs SiteAdmin vs none).
3. Give a realistic `body:json` using `{{env vars}}` where chaining matters.
4. Capture response IDs with `script:post-response` → `bru.setEnvVar(...)`.
5. Write a thorough `docs` block (this is the contract for other devs).
6. Update `docs/api.html` to match.

---

## 18. Checklist: adding a new feature

Follow **`SKILL.md §10`** as the authority; this mirrors its order. (`/add-feature`
scaffolds the module for you.)

1. **Tier decision (§7.1 / `CLAUDE.md §4.6`)** — platform vs tenant-scoped, and
   tenant-level vs branch-level. Settle this **before** the schema.
2. **Prisma model** — add to `schema.prisma` with `@@map`/`@map`, UUID PK, soft
   delete, timestamps, boolean prefixes, indexes (`tenantId`/`branchId`/
   `deletedAt`). If tenant-scoped, add its **RLS policy** (and any partial unique
   index) to `prisma/rls.sql` in the same change.
3. **Sync the DB** — `pnpm prisma db push` + `pnpm prisma generate` (stop node
   first on Windows); re-apply `rls.sql`.
4. **Scaffold the module** — `module/controller/service/dto/entities/exceptions`;
   `imports: [PrismaModule, ...deps]`, `providers: [Service]`, `exports: [Service]`.
5. **DTOs** (§3) — create/update/list-query with class-validator only.
6. **Typed exceptions** (§4) in `exceptions/`.
7. **Service** (§2, §6, §7) — context-scoped queries (`{ tenantId, deletedAt: null }`
   (+ `branchId`)), JSDoc on public methods, `withTenant`/`$transaction` for
   multi-step writes, validate any client `branchId`.
8. **Controller** (§2, §9) — thin routes, context decorators, `@Audit` on writes.
9. **Register** the module in `src/app.module.ts`.
10. **Bruno `.bru` + `docs/api.html`** (§17) — mandatory.
11. **`pnpm validate`** (§16) from `kalnostics-new/` — must pass clean.

---

## 19. Common project rules (quick reference)

The non-negotiables, each linking to its section:

- **Work in `kalnostics-new/`** — run pnpm/prisma/tsc there (§0).
- **Keep controllers thin; put logic in services** (§2, §10).
- **Validate with class-validator DTOs only** — never hand-rolled checks (§3).
- **Inject services via DI; never `new`/direct file import** (§1).
- **No raw SQL except RLS setup** — Prisma for everything (§6).
- **Tenant & branch come from context (JWT), never the body**; every read filters
  `{ tenantId, deletedAt: null }` (+ `branchId`) (§7).
- **Soft delete** via `deletedAt`; never hard-delete business data (§6, §7).
- **Throw typed `KaltrosException`s**, never `new Error()` in a request path (§4).
- **Return raw data** — the interceptor builds the `{ success, data, meta }`
  envelope (§5).
- **Preserve JWT payloads & auth constants verbatim** (§8).
- **JSDoc every public service method** (§2).
- **TypeScript strict, no `any`; run `pnpm validate` before committing** (§16).
- **Update Bruno docs (and `docs/api.html`) on every API change** (§17).
- **On any conflict, `CLAUDE.md` wins — flag it** (§0).
