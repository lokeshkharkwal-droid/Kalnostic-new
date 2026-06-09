# SKILL.md — Reusable Patterns & Templates

> Copy-paste-friendly templates for **Kalnostics New**. Every pattern here
> encodes the rules in `CLAUDE.md` (read §4 persistence & §5 auth first). When
> you build something new, start from the relevant template — don't reinvent it.
>
> Audience: a junior NestJS developer. Code is commented on purpose.

---

## Table of Contents

1. [Module scaffold](#1-module-scaffold)
2. [Prisma model template](#2-prisma-model-template)
3. [Service template (Prisma-direct + tenant scoping)](#3-service-template)
4. [DTO templates](#4-dto-templates)
5. [Error handling — KaltrosException](#5-error-handling--kaltrosexception)
6. [Response envelope & pagination (meta-based)](#6-response-envelope--pagination)
7. [Environment config](#7-environment-config)
8. [Auth & guards](#8-auth--guards)
9. [Audit logging (track tenant actions)](#9-audit-logging-track-tenant-actions)
10. [How to add a new feature (checklist)](#10-how-to-add-a-new-feature-checklist)

---

## 1. Module scaffold

**Feature/domain** modules use exactly this shape:

```
src/modules/branch/
├── branch.module.ts
├── branch.controller.ts        # HTTP layer ONLY — no business logic
├── branch.service.ts           # business logic + Prisma calls (no repository layer!)
├── dto/
│   ├── create-branch.dto.ts
│   └── update-branch.dto.ts
└── entities/
    └── branch.entity.ts         # response/domain type (Prisma model is the DB truth)
```

**Infrastructure modules** (`auth`, `siteadmin`, `permissions`) may add
`guards/`, `strategies/`, `decorators/`, `constants/`, `types/`, `exceptions/`
(CLAUDE.md rule #1 exception).

```ts
// branch.module.ts
import { Module } from '@nestjs/common';
import { BranchController } from './branch.controller';
import { BranchService } from './branch.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],            // gives the service the Prisma client via DI
  controllers: [BranchController],
  providers: [BranchService],
  exports: [BranchService],           // export so other modules can inject it (rule #3)
})
export class BranchModule {}
```

---

## 2. Prisma model template

Conventions (CLAUDE.md §3 + §4): model `PascalCase` singular, table
`snake_case` plural, columns `snake_case`, **UUID v4 default**, **plain
`deletedAt` soft delete** (no archive tier).

**Two tiers** (CLAUDE.md §4.2):

```prisma
// ── Platform-level model (NO tenant_id) — sits above tenants ──
model Tenant {
  id        String   @id @default(uuid())     // Prisma-default UUID v4
  name      String
  slug      String   @unique

  createdAt DateTime  @default(now()) @map("created_at")
  updatedAt DateTime  @updatedAt      @map("updated_at")
  deletedAt DateTime? @map("deleted_at")        // NULL = active

  @@map("tenants")
  @@index([deletedAt])
}

// ── Tenant-scoped, TENANT-LEVEL model (tenant_id; no branch) ──
model UserBranchProfile {
  id        String   @id @default(uuid())
  tenantId  String   @map("tenant_id")          // every business row carries this
  personId  String   @map("person_id")
  profileKey String  @map("profile_key")

  createdAt DateTime  @default(now()) @map("created_at")
  updatedAt DateTime  @updatedAt      @map("updated_at")
  deletedAt DateTime? @map("deleted_at")

  @@map("user_branch_profiles")
  @@index([tenantId])
  @@index([deletedAt])
}

// ── Tenant-scoped, BRANCH-LEVEL model (tenant_id + nullable branch_id) ──
// Use this shape for anything that happens AT a location (orders, appointments…).
model LabOrder {
  id        String   @id @default(uuid())
  tenantId  String   @map("tenant_id")
  branchId  String?  @map("branch_id")          // nullable: row may be tenant-level too
  // …domain fields…

  createdAt DateTime  @default(now()) @map("created_at")
  updatedAt DateTime  @updatedAt      @map("updated_at")
  deletedAt DateTime? @map("deleted_at")

  @@map("lab_orders")
  @@index([tenantId])
  @@index([branchId])
  @@index([deletedAt])
}
```

> **Decide the tier first (CLAUDE.md §4.6):** platform-level (no `tenant_id`,
> rare) → tenant-scoped (default) → also branch-level if it belongs to a
> location. Tenant-scoped tables **must** get a Postgres **RLS policy** in
> `prisma/rls.sql` in the same change (CLAUDE.md §4.3). Platform tables
> (`tenants`, `persons`, `person_credentials`, `siteadmin_users`,
> `refresh_tokens`) do **not**.

---

## 3. Service template

Services call Prisma **directly** — there is no repository layer. Always filter
soft-deleted rows, and for tenant-scoped models always include `tenantId` in the
`where` — plus `branchId` for branch-level data (defence in depth on top of RLS
— CLAUDE.md §4.3/§4.7). `tenantId` and `branchId` come from the **request
context**, never the request body.

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BranchNotFoundException } from './exceptions/branch.exceptions';
import { CreateBranchDto } from './dto/create-branch.dto';

@Injectable()
export class BranchService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a branch within a tenant.
   * @param tenantId owning tenant
   * @param dto validated branch payload
   * @returns the created branch
   */
  async create(tenantId: string, dto: CreateBranchDto) {
    return this.prisma.branch.create({ data: { ...dto, tenantId } });
  }

  /**
   * Fetch one active branch scoped to its tenant.
   * @throws BranchNotFoundException if missing or soft-deleted
   */
  async findById(id: string, tenantId: string) {
    const branch = await this.prisma.branch.findFirst({
      where: { id, tenantId, deletedAt: null }, // tenant scope + soft-delete filter
    });
    if (!branch) throw new BranchNotFoundException(id);
    return branch;
  }

  /**
   * Soft-delete a branch (sets deletedAt; row is preserved).
   */
  async remove(id: string, tenantId: string) {
    await this.findById(id, tenantId);
    return this.prisma.branch.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
```

Branch-level reads add the active branch from the JWT context (never the body):

```ts
/**
 * List a branch's lab orders. Scoped to tenant + branch + not-deleted.
 * @param tenantId from @CurrentTenant()
 * @param branchId from @CurrentProfile().branchId (verified to belong to tenant)
 */
async listForBranch(tenantId: string, branchId: string) {
  return this.prisma.labOrder.findMany({
    where: { tenantId, branchId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
  });
}
```

> Multi-step writes (e.g. create tenant + admin person + credentials + profile)
> must run in a `this.prisma.$transaction(async (tx) => { … })` so they are
> atomic.

---

## 4. DTO templates

DTOs validate with `class-validator` decorators (CLAUDE.md rule #2).
`@nestjs/swagger` decorators are also allowed for doc generation.

```ts
// create-branch.dto.ts
import { IsString, MinLength, IsOptional } from 'class-validator';

export class CreateBranchDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsString()
  @IsOptional()
  branchType?: string;
}
```

```ts
// update-branch.dto.ts — explicit optional fields.
// NOTE: do NOT use `PartialType(@nestjs/mapped-types)` — that package is not
// installed and its inferred type resolves empty under our strict config.
// Re-declare each field as optional instead.
import { IsString, IsOptional, MinLength } from 'class-validator';

export class UpdateBranchDto {
  @IsString() @IsOptional() @MinLength(2)
  name?: string;

  @IsString() @IsOptional()
  branchType?: string;
}
```

> **No response DTO wrapper.** Controllers return raw data/DTOs; the global
> `ResponseInterceptor` builds the `{success,data,meta}` envelope (§6).

---

## 5. Error handling — KaltrosException

All errors extend `KaltrosException` (in `src/common/exceptions/`), which
extends NestJS `HttpException` and carries `errorCode` + `message` + server-only
`context` (CLAUDE.md rule #6). Each module defines typed exceptions.

```ts
// src/modules/branch/exceptions/branch.exceptions.ts
import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

export class BranchNotFoundException extends KaltrosException {
  constructor(id: string) {
    super('BRANCH_NOT_FOUND', 'Branch not found', { id }, HttpStatus.NOT_FOUND);
  }
}
```

Throwing it anywhere produces the standard error envelope automatically:

```json
{ "success": false, "error": { "code": "BRANCH_NOT_FOUND", "message": "Branch not found" } }
```

Never `throw new Error('...')` in a request path. For truly unexpected failures
wrap in `InternalException('operation-name', { context })` (provided in common).

---

## 6. Response envelope & pagination

A global `ResponseInterceptor` wraps every success (CLAUDE.md rule #7):

```json
{ "success": true, "data": <payload>, "meta": { "timestamp": "2026-…Z" } }
```

**Pagination is offset-based** so it maps onto the `meta` envelope. A list
service returns `{ data, total, page, limit }`; the interceptor lifts the
pagination fields into `meta` (adding `totalPages`):

```json
{
  "success": true,
  "data": [ /* items */ ],
  "meta": { "total": 100, "page": 1, "limit": 20, "totalPages": 5, "timestamp": "…" }
}
```

Shared query DTO (`src/common/dto/pagination-query.dto.ts`):

```ts
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min, Max } from 'class-validator';

export class PaginationQueryDto {
  /** 1-based page number (default 1). */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  /** page size (default 20, max 100). */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;
}
```

Service pattern:

```ts
const page = query.page ?? 1;
const limit = query.limit ?? 20;
const [data, total] = await this.prisma.$transaction([
  this.prisma.branch.findMany({
    where: { tenantId, deletedAt: null },
    skip: (page - 1) * limit,
    take: limit,
    orderBy: { createdAt: 'desc' },
  }),
  this.prisma.branch.count({ where: { tenantId, deletedAt: null } }),
]);
return { data, total, page, limit }; // interceptor reshapes into meta
```

---

## 7. Environment config

`@nestjs/config` + a **Joi** schema (`src/config/env.validation.ts`); the app
refuses to boot on bad/missing vars.

```ts
import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().port().default(3000),
  DATABASE_URL: Joi.string().uri().required(),
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_TTL: Joi.string().default('15m'),
  JWT_REFRESH_TTL_DAYS: Joi.number().default(30),
  SITEADMIN_TOKEN_TTL: Joi.string().default('8h'),
  BCRYPT_ROUNDS: Joi.number().default(12),
});
```

---

## 8. Auth & guards

Two separate systems — see CLAUDE.md §5 for the **exact** JWT payloads and
constants (preserve verbatim). Key pieces:

- **Business:** `JwtStrategy` (`'jwt'`), global `JwtAuthGuard` (everything
  protected; `@Public()` opts out), `@CurrentUser()` / `@CurrentTenant()` /
  `@CurrentProfile()` param decorators.
- **SiteAdmin:** `SiteAdminJwtStrategy` (`'jwt-siteadmin'`, rejects non-siteadmin
  tokens), `SiteAdminPermissionGuard` (validates token then AND-checks
  `@RequireSiteAdminPermission()`), `@CurrentSiteAdmin()`.

Protecting a route:

```ts
@UseGuards(JwtAuthGuard)           // or omit — global guard already applies
@Get('me')
me(@CurrentUser() user: JwtPayload) { return user; }
```

Constants to never drift: access 15m / refresh 30d / siteadmin 8h · lockout
10 attempts→15 min · bcrypt cost 12 · password min-8/1-upper/1-digit · temp
password & `system_username` formats exclude `I O 0 1`.

---

## 9. Audit logging (track tenant actions)

Every tenant-scoped **write** is recorded in the `audit_logs` table (who did
what, in which module, from which IP, and when) by a global `AuditInterceptor`.
You opt a route in **declaratively** with the `@Audit(...)` decorator — there is
**no manual logging code in services**.

```ts
// src/modules/branch/branch.controller.ts
import { AuditAction, AuditModule } from '@prisma/client';
import { Audit } from '../../common/decorators/audit.decorator';

@Post()
@Audit({
  module: AuditModule.BRANCH,
  action: AuditAction.CREATE,
  description: 'Created a branch',
})
create(@CurrentTenant() tenantId: string, @Body() dto: CreateBranchDto) {
  return this.branchService.create(tenantId, dto);
}
```

What gets saved (snapshotted from the JWT + request, so the log stays readable
later): actor `person_id`, role (`active_profile_key` + its label), `tenant_id`,
active `branch_id`, the client IP, and your `module` / `action` / `description`.
The write is **fire-and-forget** — a failed audit write logs an error but never
blocks or fails the user's request.

**Rules:**

- Annotate **every mutating route** (`POST` / `PUT` / `PATCH` / `DELETE`) of a
  tenant feature. Reads (`GET`) are not logged.
- The route must run under the business `JwtAuthGuard` (the default). Routes that
  are unannotated, `@Public()`, or SiteAdmin-only are **not** business-audited —
  with no `req.user.tenant_id` there is no tenant to scope the row to, so the
  interceptor skips them.
- **New feature area?** Add a value to the `AuditModule` enum in
  `prisma/schema.prisma` (+ a migration) before referencing it. Pick the closest
  existing `AuditAction`, or use `OTHER`.
- **Flows without `req.user`** (e.g. login/logout on `@Public()` auth routes):
  inject the exported `AuditService` and call `auditService.record({ … })`
  directly — pass `tenantId` and actor fields explicitly.

> The read API lives in `src/modules/audit` (`GET /audits`, `GET /audits/:id`):
> paginated and filterable by module / action / actor / branch / date range,
> plus a free-text `search` over the user and description.

---

## 10. How to add a new feature (checklist)

- [ ] **0. Decide the tier (FIRST — CLAUDE.md §4.6).** Platform-level (no
      `tenantId`, rare — justify it) → tenant-scoped (default) → also
      **branch-level** (nullable `branchId`) if a row belongs to a location.
- [ ] **Model** — add the Prisma model (§2): UUID v4 id, `createdAt`,
      `updatedAt`, `deletedAt`. Tenant-scoped → `tenantId` + `@@index([tenantId])`.
      Branch-level → also `branchId String?` + `@@index([branchId])`.
- [ ] **RLS** — tenant-scoped table → add its policy to `prisma/rls.sql` in the
      **same change**.
- [ ] **Migrate** — `prisma migrate dev --name add_<thing>`; commit it.
- [ ] **Folder** — `src/modules/<feature>/` with the §1 scaffold.
- [ ] **DTOs** — `create-*.dto.ts` (class-validator), `update-*.dto.ts` with
      **explicit optional fields** (not `PartialType`) (§4). DTOs do **not**
      contain `tenantId`/`branchId` — those come from context.
- [ ] **Exceptions** — typed `KaltrosException` subclasses for this module (§5).
- [ ] **Service** — Prisma-direct (§3); every read includes
      `{ tenantId, deletedAt: null }` (+ `branchId` for branch-level); set
      `tenantId`/`branchId` from context on writes; soft-delete not hard-delete;
      `$transaction` for multi-step writes; verify any client `branchId` via
      `BranchService.findById(branchId, tenantId)`.
- [ ] **Controller** — thin; `@CurrentTenant()` for tenant, `@CurrentProfile()`
      for active branch; return raw data (interceptor wraps it); list endpoints
      return `{ data, total, page, limit }` (§6); add guards/`@Public()`.
- [ ] **Audit** — add `@Audit({ module, action, description })` to **every write
      endpoint** so tenant actions are recorded (§9). New module area → add an
      `AuditModule` enum value (+ migration) first.
- [ ] **Module wiring** — `imports: [PrismaModule, …]`; `exports` the service if
      others need it; never import another service's file directly (rule #3).
- [ ] **Register** — add the module to `AppModule.imports`.
- [ ] **JSDoc** — every public method (rule #5).
- [ ] **Verify** — `prisma generate`, `nest build`, `eslint` all green.
- [ ] **Commit** — Conventional Commits, e.g. `feat(lab): add lab order CRUD`.
