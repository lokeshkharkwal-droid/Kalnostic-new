# Backend Requirements for the Frontend

> **Purpose.** A single reference for setting up the **Kalnostics New** backend
> and preparing a working **`business_admin`** account so the `kaltros-fe`
> business frontend works end-to-end — from login through branches, staff,
> permissions and the lab catalogue.
>
> **Scope.** Only **implemented** endpoints are documented here. Every API,
> request body and validation rule below is taken from the Bruno collection in
> `kalnostics-new/bruno/` and the backend source — nothing is aspirational. If a
> frontend screen needs something not listed here, it is not yet built on the
> backend.
>
> **Audience.** A developer standing up the backend locally and seeding a tenant
> so the frontend can be exercised. Assumes the user will end up logged in as
> `business_admin`.

---

## 1. How the frontend and backend fit together

- The **frontend** (`kaltros-fe`) is a React/Vite SPA. It reads its API base URL
  from the env var **`VITE_API_BASE`** (e.g. `http://localhost:3000/api/v1`).
- It authenticates with the **business JWT**, stores the access + refresh tokens
  in `localStorage`, attaches `Authorization: Bearer <accessToken>` to every
  request via an Axios interceptor, and **silently refreshes** on a `401`.
- It **decodes the JWT client-side** (no signature check on the FE) to read the
  user's identity, active branch, and `profiles[]` for the branch/role switcher.
  The payload shape is therefore a hard contract (see §4.2).
- Every response is expected in the **envelope** described in §3. The FE unwraps
  `data` automatically; controllers return raw payloads.

---

## 2. Prerequisites & environment

### 2.1 Toolchain

| Requirement | Notes |
| ----------- | ----- |
| Node.js LTS | Per `package.json` engines |
| PostgreSQL  | Tenant isolation uses Row-Level Security (see `prisma/rls.sql`) |
| `pnpm`      | All commands run from **`kalnostics-new/`** (the actual app + git repo) |

### 2.2 Backend environment variables

Copy `kalnostics-new/.env.example` → `.env` and fill in real values. Validated at
boot by `src/config/env.validation.ts`.

| Var | Required | Purpose |
| --- | -------- | ------- |
| `NODE_ENV` | yes | `development` locally |
| `PORT` | yes | App port (default `3000`) |
| `DATABASE_URL` | yes | Postgres connection string. For RLS to enforce, the role must **not** be a superuser/table-owner/`BYPASSRLS`. |
| `JWT_SECRET` | yes | **≥ 32 chars.** Shared by both auth strategies (business + SiteAdmin). |
| `JWT_EXPIRES_IN` | yes | e.g. `1h` (token lifetimes are also fixed in code per §4) |
| `ENCRYPTION_KEY` | optional* | AES-256-GCM key (32 bytes / 64 hex). *Required to store Aadhaar numbers.* Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `UPLOAD_DIR` | yes | Profile-photo upload dir (default `./uploads`) |
| `MAX_UPLOAD_BYTES` | yes | Max upload size (default `2097152` = 2 MB) |
| `AUDIT_RETENTION_DAYS` | yes | Audit-log retention (default `90`) |
| `RLS_ENABLED` | yes | Leave `false` until `rls.sql` is applied + a non-owner DB role is used. Set `true` to make Postgres RLS the tenant-isolation backstop. |

### 2.3 Frontend environment variable

| Var | Value (local) | Purpose |
| --- | ------------- | ------- |
| `VITE_API_BASE` | `http://localhost:3000/api/v1` | Backend base URL the SPA calls |

### 2.4 Run the backend

```bash
cd kalnostics-new
pnpm install
pnpm prisma migrate deploy      # or `prisma migrate dev` for a fresh dev DB
pnpm prisma db seed             # seeds the SiteAdmin super_owner (see below)
pnpm start:dev                  # serves on http://localhost:3000/api/v1
```

The seed creates a SiteAdmin **super_owner**:
`admin@kalnostics.com` / `SuperSecret1` (from `prisma/seed.ts`). You need it to
create the first tenant.

### 2.5 Base URL & global prefix

All routes are prefixed with **`/api/v1`** (`src/main.ts`). Throughout this doc,
paths are written relative to that prefix; full URL = `http://localhost:3000/api/v1` + path.

---

## 3. API conventions (every endpoint)

### 3.1 Success envelope

```json
{
  "success": true,
  "data": { /* the payload the controller returned */ },
  "meta": { "timestamp": "2026-06-24T10:00:00.000Z" }
}
```

Paginated lists lift pagination into `meta`:

```json
{
  "success": true,
  "data": [ /* rows */ ],
  "meta": { "timestamp": "…", "total": 42, "page": 1, "limit": 20, "totalPages": 3 }
}
```

### 3.2 Error envelope

```json
{
  "success": false,
  "error": { "code": "MODULE_NOT_ENABLED_FOR_BRANCH", "message": "…" }
}
```

- `code` is a machine-readable `SCREAMING_SNAKE_CASE` string the FE can switch on.
- The HTTP status is a **real** status (`400/401/403/404/409/422/500`) — the body
  is never `2xx` with `success: false`.
- A server-side `context` object is logged but **never** returned to the client.

### 3.3 Auth header

Authenticated requests must send `Authorization: Bearer <accessToken>`. The
global `JwtAuthGuard` protects everything except routes marked `@Public()`
(`/auth/login`, `/auth/refresh`, `/siteadmin/auth/login`).

### 3.4 Pagination query

List endpoints accept `?page=<1-based>&limit=<size>` (`PaginationQueryDto`,
default `page=1`, `limit=20`, capped at `100`).

### 3.5 CORS

CORS is configurable via `CORS_ORIGIN`; the API allows the custom headers
`x-tenant-id` and `x-branch-id` in addition to `Authorization`.

---

## 4. Authentication requirements

Two **completely separate** auth systems. The token from one cannot be used on
the other (a `type` discriminator + distinct Passport strategy names enforce it).

### 4.1 Business-user auth (`'jwt'`)

- **Login:** `POST /auth/login` (public).
- **Access token: 15 min. Refresh token: 30 days**, single-use rotation,
  SHA-256-hashed at rest, revocable.
- **Login identifier precedence:** `phone → email → system_username`. The FE
  sends whatever the user typed in `identifier`; the backend resolves in that
  order.
- For **staff** login, `tenantSlug` is required to set the tenant context. The
  first `business_admin` can log in with just phone + temp password.

### 4.2 Business JWT payload (hard contract — FE decodes this)

```jsonc
{
  "person_id": "uuid",
  "tenant_id": "uuid",
  "active_branch_id": "uuid | null",      // null for tenant-level profiles
  "active_branch_type": "DIAGNOSTIC | … | null",
  "active_profile_key": "business_admin | branch_admin | …",
  "is_patient_context": false,
  "is_patient": false,
  "platform_mrn": "KAL-… | null",
  "profiles": [
    {
      "branch_id": "uuid | null",
      "branch_name": "string | null",
      "branch_type": "string | null",
      "profile_key": "business_admin",
      "profile_label": "Business Admin",
      "is_default": true
    }
  ],
  "iat": 0,
  "exp": 0
}
```

The **full `profiles[]` array is embedded** so the FE branch/role switcher needs
no extra call. Branch fields are `null` for tenant-level profiles
(`business_admin`, `administrator`, `patient`).

### 4.3 SiteAdmin auth (`'jwt-siteadmin'`)

- **Login:** `POST /siteadmin/auth/login` (public, **email-only**).
- **Access token: 8 h.** Payload: `{ type: 'siteadmin', siteadmin_id, email, role, iat?, exp? }`.
- 4 cumulative roles: `content_admin → operations_admin → full_admin → super_owner`.
- Used only for platform tooling (creating tenants, managing SiteAdmins). The
  business FE does **not** use this.

### 4.4 Shared auth constants

- **Lockout:** 10 failed attempts → **15-minute** lock (auto-unlock). Both systems.
- **Password policy:** min 8 chars, ≥1 uppercase, ≥1 digit (staff create also
  requires a special char); bcrypt cost 12.
- **Temp password (auto-generated):** 1 upper + 5 lower + 2 digits, excluding `I O 0 1`.

### 4.5 RBAC status (important for the FE)

Business routes are **authenticated** (a valid business JWT is required) but do
**not** yet enforce per-permission RBAC at the route level. Permission baselines
+ overrides are resolved as **data** for the FE to render show/hide (see §5.11).
SiteAdmin routes **do** enforce role/permission.

---

## 5. Step-by-step setup (the spine)

Follow these in order. Steps 1–2 are SiteAdmin; everything from step 3 on uses the
`business_admin` token. **Ordering matters** where flagged.

> **Shell convention.** Examples below assume `BASE=http://localhost:3000/api/v1`
> and reuse captured values (`SA_TOKEN`, `BIZ_TOKEN`, `BRANCH_ID`, …). The full
> chained sequence is in the §8 appendix.

### Step 1 — SiteAdmin login

`POST /siteadmin/auth/login` · public · returns an 8 h SiteAdmin token.

```bash
curl -s -X POST "$BASE/siteadmin/auth/login" \
  -H "Content-Type: application/json" \
  -d '{ "email": "admin@kalnostics.com", "password": "SuperSecret1" }'
# → data.accessToken  (save as SA_TOKEN)
```

### Step 2 — Create the tenant + first business_admin

`POST /siteadmin/tenants` · SiteAdmin token · requires `business:create`
(`operations_admin`+). Returns the tenant **and a one-time temp password** for the
business_admin.

- `slug`: lowercase alphanumeric + hyphens (subdomain), not at start/end.
- `adminPhone`: globally-unique login identifier.
- `mrnPrefix`: patient MRN prefix (e.g. `"AC"` → `AC-00001`).

```bash
curl -s -X POST "$BASE/siteadmin/tenants" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SA_TOKEN" \
  -d '{
    "name": "Acme Diagnostics",
    "slug": "acme-diagnostics",
    "adminFirstName": "Alice",
    "adminLastName": "Admin",
    "adminPhone": "+919812345675",
    "adminEmail": "alice.admin@acme.test",
    "email": "contact@acme.test",
    "phone": "+919800000000",
    "mrnPrefix": "AC",
    "address": { "line1": "12 Lab Street", "city": "Pune", "country": "IN" },
    "settings": {}
  }'
# → data.id (tenantId), data.slug (tenantSlug),
#   data.adminPhone + data.tempPassword (the one-time business_admin password)
```

> If the temp password is not echoed in your environment, use
> `POST /siteadmin/tenants/:id/admin/reset-password` to mint a new one.

### Step 3 — Business login (become `business_admin`)

`POST /auth/login` · public. Use the admin phone + temp password. `tenantSlug` is
recommended (required for staff in general).

```bash
curl -s -X POST "$BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "identifier": "+919812345675",
    "password": "<tempPassword>",
    "tenantSlug": "acme-diagnostics"
  }'
# → data.accessToken (BIZ_TOKEN, 15 min), data.refreshToken (30 days)
```

### Step 4 — (optional) Replace the temp password

`POST /auth/change-password` · business token.

```bash
curl -s -X POST "$BASE/auth/change-password" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $BIZ_TOKEN" \
  -d '{ "currentPassword": "<tempPassword>", "newPassword": "NewBizPass123" }'
```

### Step 5 — Create a branch

`POST /branches` · business token. Tenant comes from the JWT. `code` is
auto-generated per-tenant (`BR-00001`…) and **must not** be sent. `name` must be
unique among active branches (else `409`).

`branchType` ∈ `DIAGNOSTIC | RADIOLOGY | OPD | IPD | PHARMACY | INVENTORY |
BLOOD_BANK | FRANCHISE | COMBINED | COLLECTION_CENTER`. `receivingBranchIds` is
only for `COLLECTION_CENTER`.

```bash
curl -s -X POST "$BASE/branches" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $BIZ_TOKEN" \
  -d '{
    "name": "Kothrud Main Lab",
    "branchType": "DIAGNOSTIC",
    "phone": "+919822222222",
    "email": "main@acme.test",
    "addressLine": "12 Lab Street",
    "city": "Pune",
    "state": "Maharashtra",
    "pincode": "411038"
  }'
# → data.id (BRANCH_ID)
```

> The **first** branch in a tenant is auto-set as the main branch.

### Step 6 — Set the main branch (if changing it)

`PUT /branches/main-branch` · business token · idempotent upsert (one main branch
per tenant). `branchId` must belong to the caller's tenant (else `404`).

```bash
curl -s -X PUT "$BASE/branches/main-branch" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $BIZ_TOKEN" \
  -d '{ "branchId": "'"$BRANCH_ID"'" }'
```

### Step 7 — Enable modules on the branch ⚠️ REQUIRED BEFORE USERS

`PUT /branches/:id/modules` · business token. Gates which work-area modules can be
a user's default module and which appear in the per-user permission modal.
`moduleKey` must be one of the master modules (see §5.10 / `GET /users/manage/modules`).
**If you skip this, creating/assigning a user for that branch fails with `422
MODULE_NOT_ENABLED_FOR_BRANCH`.**

```bash
curl -s -X PUT "$BASE/branches/$BRANCH_ID/modules" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $BIZ_TOKEN" \
  -d '{
    "modules": [
      { "moduleKey": "registration", "isEnabled": true },
      { "moduleKey": "accession", "isEnabled": true },
      { "moduleKey": "lab_operations", "isEnabled": true },
      { "moduleKey": "sales", "isEnabled": true },
      { "moduleKey": "branch_admin", "isEnabled": true }
    ]
  }'
```

### Step 8 — Create a staff user

`POST /users/manage` · business token. Creates the Person (Aadhaar encrypted),
credentials (`username` + `password`), staff membership (sequential `userCode`),
and branch assignment(s).

Key rules (all declarative validation):
- `employeeName` / parents: letters + spaces. `username`: lowercase `[a-z0-9._]`,
  **immutable**. `dateOfBirth`: ≥ 18 years. `aadhaarNumber`: 12 digits.
  `panNumber`: `AAAAA9999A`. `mobileNumber`: Indian 10-digit. `password`: ≥8 with
  upper/lower/digit/special. `userType`: `INTERNAL | EXTERNAL`.
- Role is assigned **per branch** via `branches[].roleKey` (one role per branch).
  Top-level `roleKey` is an **optional** default — omit it and assign later.
- Each `branches[].roleKey` must be valid for the branch's type
  (`PROFILE_BRANCH_MATRIX`). **Exactly one** branch entry may be `isDefault: true`.
- `branches[].moduleId` must be a module **enabled for that branch** (Step 7) else
  `422 MODULE_NOT_ENABLED_FOR_BRANCH`; if the role template links specific modules
  it must be one of them else `422 MODULE_NOT_IN_ROLE_TEMPLATE`.

```bash
curl -s -X POST "$BASE/users/manage" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $BIZ_TOKEN" \
  -d '{
    "employeeName": "Satyam Sharma",
    "username": "satyam.sharma",
    "dateOfBirth": "1995-04-12",
    "gender": "MALE",
    "bloodGroup": "O_POS",
    "nationality": "Indian",
    "aadhaarNumber": "123456789012",
    "panNumber": "ABCDE1234F",
    "address": "12 MG Road, Bengaluru",
    "email": "satyam.sharma@acme.test",
    "mobileNumber": "9812348678",
    "password": "Str0ng@Pass1",
    "userType": "INTERNAL",
    "status": "ACTIVE",
    "branches": [
      { "branchId": "'"$BRANCH_ID"'", "roleKey": "branch_admin", "moduleId": "branch_admin", "isDefault": true, "branchStatus": "ACTIVE" }
    ]
  }'
# → data.person.id (USER_ID), data.userCode, data.loginIdentifier
```

### Step 9 — Assign / update branch assignments (bulk)

`POST /users/manage/:id/branches` · business token. Same per-branch role/module
rules as Step 8; an existing assignment for a branch is re-roled in place.
Exactly one `isDefault: true` (else `422 MULTIPLE_DEFAULT_BRANCH`).

```bash
curl -s -X POST "$BASE/users/manage/$USER_ID/branches" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $BIZ_TOKEN" \
  -d '{
    "branches": [
      { "branchId": "'"$BRANCH_ID"'", "roleKey": "lab_technician", "moduleId": "lab_operations", "isDefault": true, "branchStatus": "ACTIVE" }
    ]
  }'
```

### Step 9b — Grant extra permissions to a staff user (per-branch overrides)

`PUT /users/manage/:id/branch-permissions` · business token. This is how you give
a staff member access **beyond their role's baseline** (or revoke part of it)
after creation — fine-grained, **per branch**.

- Body: `{ branchId, items: [{ moduleKey, permissionKey, allowed }] }`. The client
  sends the **full override set for that branch** — it **replaces** the previous
  grants (supports Select-All / Deselect-All per module). Any permission you omit
  falls back to the role baseline.
- `allowed: true` grants extra access; `allowed: false` revokes a role-granted one.
- **Only modules enabled for the branch are accepted** (Step 7), and each
  `permissionKey` must belong to its `moduleKey` — else `422 INVALID_MODULE_KEY` /
  `MODULE_NOT_ENABLED_FOR_BRANCH`. Get valid keys from
  `GET /users/manage/permission-catalog`.
- Effective value the FE sees = `(module enabled for branch) AND (override ?? role baseline)`.

```bash
curl -s -X PUT "$BASE/users/manage/$USER_ID/branch-permissions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $BIZ_TOKEN" \
  -d '{
    "branchId": "'"$BRANCH_ID"'",
    "items": [
      { "moduleKey": "lab_operations", "permissionKey": "lab_operations:view", "allowed": true },
      { "moduleKey": "lab_operations", "permissionKey": "lab_operations:enter_results", "allowed": true },
      { "moduleKey": "lab_operations", "permissionKey": "lab_operations:verify", "allowed": true },
      { "moduleKey": "sales", "permissionKey": "sales:view", "allowed": true }
    ]
  }'
```

> Verify the result with the **per-user** read
> `GET /users/manage/:id/branch-permissions?branchId=<id>` (distinct from
> `/me/permissions` in §5.11, which resolves the *caller's* own permissions).

### Step 10 — Build the lab catalogue

Tenant-level classification first, then per-branch master data, then tests/panels.

**10a. Department** — `POST /departments` (tenant-level). `shortName` is required,
`^[A-Z0-9]{2,6}$`, unique per tenant. `moduleMapping` required (branchType enum).

```bash
curl -s -X POST "$BASE/departments" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $BIZ_TOKEN" \
  -d '{ "name": "Pathology", "shortName": "PATH", "description": "Clinical pathology",
        "isActive": true, "moduleMapping": ["DIAGNOSTIC"], "personMappings": [] }'
# → data.id (DEPARTMENT_ID); code auto = {INITIALS}-Dep-{n}
```

**10b. Category** — `POST /categories`. `categoryType` ∈ `INDEPENDENT | UNDER_DEPARTMENT`.
For `UNDER_DEPARTMENT`, `departmentId` is required.

```bash
curl -s -X POST "$BASE/categories" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $BIZ_TOKEN" \
  -d '{ "name": "Hematology Panel", "shortName": "HEM", "isActive": true,
        "categoryType": "UNDER_DEPARTMENT", "departmentId": "'"$DEPARTMENT_ID"'",
        "moduleMapping": ["DIAGNOSTIC"], "personMappings": [] }'
# → data.id (CATEGORY_ID)
```

**10c. Sub-Category** — `POST /sub-categories`. `subCategoryType` ∈
`INDEPENDENT | UNDER_DEPARTMENT | UNDER_CATEGORY`. For `UNDER_CATEGORY`,
`categoryId` is required (and `departmentId` omitted).

```bash
curl -s -X POST "$BASE/sub-categories" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $BIZ_TOKEN" \
  -d '{ "name": "Complete Blood Count", "shortName": "CBC", "isActive": true,
        "subCategoryType": "UNDER_CATEGORY", "categoryId": "'"$CATEGORY_ID"'",
        "moduleMapping": ["DIAGNOSTIC"], "personMappings": [] }'
# → data.id (SUB_CATEGORY_ID)
```

**10d. Master Data** — auto-provisioned per branch on branch creation. The
**main** branch keeps only its single auto-created master data (creating more
returns `409 CANNOT_CREATE_MASTER_DATA_FOR_MAIN_BRANCH`). To create extra master
data, target a **non-main** branch:

```bash
curl -s -X POST "$BASE/master-data" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $BIZ_TOKEN" \
  -d '{ "branchId": "<non-main branchId>", "name": "Radiology Catalogue", "description": "…" }'
# → data.id (MASTER_DATA_ID). Optional copyFromMasterDataId clones tests in.
```

> To get the auto-created master data id for a branch, use
> `GET /master-data` (paginated, tenant-scoped) and pick the branch's row.

**10e. Lab Test** — `POST /master-data/:masterDataId/lab-tests`. `testName`/`testCode`
unique per master data. Enums UPPERCASE. Cross-field: `priceMaximum ≤ priceMsrp`,
`priceMinimum ≤ priceMaximum`; per range `lowerLimit ≤ upperLimit`, etc.

```bash
curl -s -X POST "$BASE/master-data/$MASTER_DATA_ID/lab-tests" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $BIZ_TOKEN" \
  -d '{
    "testName": "Complete Blood Count", "testCode": "CBC",
    "processMethod": "SINGLE_STEP", "samplePriorityType": "ROUTINE",
    "priceMsrp": 700, "priceMaximum": 650, "priceMinimum": 400,
    "tatMinValue": 2, "tatMinUnit": "HOURS", "tatMaxValue": 24, "tatMaxUnit": "HOURS",
    "scheduleDays": ["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY"],
    "samples": [ { "containerType": "EDTA_TUBE_PURPLE_TOP", "sampleSize": "3 mL", "numberOfSamples": 1, "isDefault": true } ],
    "resultParams": [
      { "parameterName": "Haemoglobin", "parameterCode": "HGB", "reportingUnit": "g/dL",
        "resultType": "QUANTITATIVE", "parameterType": "MEASURED", "decimalPlaces": 1, "sortOrder": 1,
        "referenceRanges": [ { "gender": "MALE", "ageFrom": 18, "ageFromUnit": "YEARS", "ageTo": 99, "ageToUnit": "YEARS", "lowerLimit": 13.0, "upperLimit": 17.0 } ] }
    ]
  }'
# → data.id (LAB_TEST_ID)
```

**10f. Lab Panel** — `POST /master-data/:masterDataId/lab-panels`. `tests[].labTestId`
must reference an active lab test **in the same master data**.

```bash
curl -s -X POST "$BASE/master-data/$MASTER_DATA_ID/lab-panels" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $BIZ_TOKEN" \
  -d '{
    "panelName": "Full Body Checkup", "panelCode": "FBC",
    "applicableGender": "ALL", "applicableAgeGroup": "ADULT", "reportType": "COMBINED",
    "turnaroundPriority": "ROUTINE", "isActive": true,
    "priceMsrp": 2500, "priceMaximum": 2300, "priceMinimum": 1800,
    "tests": [ { "labTestId": "'"$LAB_TEST_ID"'", "sortOrder": 1, "isRemovable": true } ]
  }'
# → data.id (LAB_PANEL_ID)
```

### Step 11 — Resolve permissions for the FE

`GET /users/manage/me/permissions?branchId=<id>` · business token. `branchId` is
**required** (omit → `400`; foreign branch → not-found). Returns the **complete**
catalogue so the FE can render a full grid:

```jsonc
{
  "role": { "key": "business_admin", "label": "Business Admin" }, // null if no assignment here
  "branchModules": [ { "moduleKey": "lab_operations", "label": "Lab Operations" } ],
  "modules": [
    { "moduleKey": "admin", "moduleLabel": "Admin", "moduleAllowed": true,
      "permissions": [ { "permissionKey": "admin:view", "action": "view", "label": "…", "baseline": true, "allowed": true } ] }
  ],
  "allowed": [ "admin:view", "admin:edit", "admin:manage_users" ] // flat list the FE keys off
}
```

`allowed = (module enabled for branch) AND (per-branch override ?? role baseline)`.

---

## 6. Endpoint reference (implemented)

All business routes need `Authorization: Bearer <businessAccessToken>` unless
marked Public. SiteAdmin routes need the SiteAdmin token.

### 6.1 Business auth — `/auth`

| Method | Path | Auth | Body / notes |
| ------ | ---- | ---- | ------------ |
| POST | `/auth/login` | Public | `{ identifier, password, tenantSlug? }` → `{ accessToken, refreshToken }` |
| POST | `/auth/refresh` | Public | `{ refreshToken }` → new `{ accessToken, refreshToken }` (rotation) |
| POST | `/auth/logout` | Bearer | Revokes refresh tokens |
| POST | `/auth/change-password` | Bearer | `{ currentPassword, newPassword }` |
| POST | `/auth/switch-profile` | Bearer | `{ branchId?, profileKey }` → re-issued token for new active profile |
| GET  | `/auth/me` | Bearer | Returns the current JWT payload |

### 6.2 SiteAdmin — `/siteadmin/*`

| Method | Path | Auth | Notes |
| ------ | ---- | ---- | ----- |
| POST | `/siteadmin/auth/login` | Public | Email-only → 8 h token |
| POST | `/siteadmin/tenants` | SiteAdmin (`business:create`) | Create tenant + first business_admin (+ temp password) |
| GET  | `/siteadmin/tenants` | SiteAdmin | Paginated tenant list |
| GET  | `/siteadmin/tenants/:id` | SiteAdmin | Tenant detail |
| PATCH| `/siteadmin/tenants/:id` | SiteAdmin | Update tenant |
| GET  | `/siteadmin/tenants/:id/admin` | SiteAdmin | The tenant's business_admin |
| POST | `/siteadmin/tenants/:id/admin/reset-password` | SiteAdmin | New one-time temp password |
| POST/GET/PATCH | `/siteadmin/users` (+ `:id` ops) | SiteAdmin | Manage SiteAdmin accounts |

### 6.3 Branches — `/branches`

| Method | Path | Body / notes |
| ------ | ---- | ------------ |
| POST | `/branches` | Create (code auto `BR-00001`; never sent). `name` unique → 409 |
| GET | `/branches` | Paginated, tenant-scoped |
| GET | `/branches/:id` | One branch |
| PATCH | `/branches/:id` | Update (all fields optional) |
| DELETE | `/branches/:id` | Soft delete |
| GET | `/branches/main-branch` | Current main branch |
| PUT | `/branches/main-branch` | `{ branchId }` — set/change main |
| GET | `/branches/:id/modules` | Enabled/disabled modules |
| PUT | `/branches/:id/modules` | `{ modules: [{ moduleKey, isEnabled }] }` |
| GET | `/branches/:id/collection-mappings` | `COLLECTION_CENTER` only |
| PUT | `/branches/:id/collection-mappings` | `{ receivingBranchIds: [] }` |

### 6.4 Users & permissions — `/users/manage`

| Method | Path | Body / notes |
| ------ | ---- | ------------ |
| POST | `/users/manage` | Create staff (see §5.8) |
| GET | `/users/manage` | Paginated, filterable staff list |
| GET | `/users/manage/:id` | Detail (Aadhaar masked) |
| PATCH | `/users/manage/:id` | Update identity / password / status |
| POST | `/users/manage/:id/photo` | Profile photo (JPG/PNG, ≤2 MB) |
| POST | `/users/manage/:id/branches` | Bulk assign/update branch assignments |
| PATCH | `/users/manage/:id/branches/:branchId` | Update one assignment |
| PATCH | `/users/manage/:id/activate` · `/deactivate` | Tenant-wide status |
| GET | `/users/manage/:id/branch-permissions?branchId=` | A user's perms at a branch |
| PUT | `/users/manage/:id/branch-permissions` | Replace a user's per-branch overrides |
| GET | `/users/manage/me/permissions?branchId=` | Current user's effective perms (§5.11) |
| GET | `/users/manage/permissions` | One row per (active user + branch) — permissions screen |
| GET | `/users/manage/roles` | Static role catalogue `[{ key, label }]` |
| GET | `/users/manage/modules` | Static module catalogue (see §6.6) |
| GET | `/users/manage/permission-catalog` | Full module-grouped permission catalogue |

### 6.5 Lab catalogue

| Area | Base path | Notes |
| ---- | --------- | ----- |
| Departments | `/departments` | Tenant-level. CRUD + soft delete. `shortName` `^[A-Z0-9]{2,6}$`, unique per tenant |
| Categories | `/categories` | `categoryType` INDEPENDENT / UNDER_DEPARTMENT |
| Sub-Categories | `/sub-categories` | `subCategoryType` INDEPENDENT / UNDER_DEPARTMENT / UNDER_CATEGORY |
| Master Data | `/master-data` | Auto-provisioned per branch; manual create for non-main branches only |
| Lab Tests | `/master-data/:masterDataId/lab-tests` | CRUD + `/listing`, `/clone`, `/bulk`, `/import`, `/:id/versions` |
| Lab Panels | `/master-data/:masterDataId/lab-panels` | CRUD + `/listing`, `/bulk` |

Each CRUD area also exposes `GET` (list, paginated), `GET /:id`, `PATCH /:id`,
`DELETE /:id` (soft delete). Lab-test list has a richer `…/listing` variant with
search + classification/status filters and projected columns.

### 6.6 Module & role catalogues (static)

`GET /users/manage/modules` → 14 operational modules + 2 admin consoles:
`registration, accession, lab_operations, inventory, sales, admin, radiology,
pharmacy, opd, ipd, finance, phlebotomist, assistant, operation` + consoles
`business_admin, branch_admin`.

`GET /users/manage/roles` → 21 role keys including `business_admin, administrator,
branch_admin, junior_lab_technician, senior_lab_technician, consultant_doctor,
reporting_doctor, phlebotomist, marketing_executive, marketing_manager,
inventory_manager, chemist, chemist_assistant, finance_manager, finance_assistant,
logistics_executive, opd_assistant, radiology_assistant, nursing_staff,
nursing_incharge`.

Tenant-level roles (`business_admin, administrator, patient`) have `branchId = null`;
branch-level roles must match the branch's type per `PROFILE_BRANCH_MATRIX`.

### 6.7 Other implemented areas

| Area | Base path | Notes |
| ---- | --------- | ----- |
| Schedules | `/branches/:branchId/schedules` | Branch shift plans. `{ planName, status?, effectiveFrom, effectiveTo?, shifts[] }`. One ACTIVE per overlapping date range |
| Audit | `/audit` (list) · `/audit/:id` | Read-only audit-log API (written by global `@Audit` interceptor) |
| Doctors | `/doctors` | Reporting & consultant doctor CRUD + `/listing` |
| Outsource Centers | `/outsource-centers` | CRUD + eligible-branches / branch-lab-items helpers |
| Referral Panels | `/referral-panels` | CRUD + search |

---

## 7. Error handling & edge cases

- **`401 Unauthorized`** on any business route ⇒ the FE auto-calls `POST /auth/refresh`
  once and retries. Return `401` for expired/invalid tokens; support rotation.
- **Tenant/branch scoping:** `tenantId` and the active branch come from the **JWT**,
  never from the request body. A `tenantId`/`branchId` in a body that doesn't match
  the caller's context is rejected (`404`/`422`). The FE never sends `tenantId`.
- **Module gating:** `422 MODULE_NOT_ENABLED_FOR_BRANCH` (enable modules first, §5.7)
  and `422 MODULE_NOT_IN_ROLE_TEMPLATE` (module not linked to the role template).
- **Default branch:** `422 MULTIPLE_DEFAULT_BRANCH` if more than one assignment is
  `isDefault: true`.
- **Uniqueness conflicts (`409`):** branch `name`; `DEPARTMENT_NAME_CONFLICT` /
  `DEPARTMENT_SHORT_NAME_CONFLICT`; `CATEGORY_*` / `SUB_CATEGORY_*` short-name
  conflicts; `MASTER_DATA_NAME_CONFLICT`; `LAB_TEST_NAME_CONFLICT` /
  `LAB_TEST_CODE_CONFLICT` / `LAB_TEST_PARAM_CODE_CONFLICT`; `LAB_PANEL_NAME_CONFLICT`
  / `LAB_PANEL_CODE_CONFLICT`.
- **Main-branch master data:** `409 CANNOT_CREATE_MASTER_DATA_FOR_MAIN_BRANCH`.
- **Cross-field price/range:** `422 VALIDATION_ERROR` (e.g. `priceMaximum ≤ priceMsrp`).
- **Lockout:** 10 failed logins → 15-min lock (both auth systems).
- **Validation errors (`400`):** class-validator field errors (e.g. missing
  `shortName`, bad `panNumber`/`aadhaarNumber`/`mobileNumber` format).

---

## 8. Quick-start cURL appendix (happy path)

> **Prefer Bruno?** The same sequence is available as a runnable, self-chaining
> Bruno folder: **`bruno/00 Setup Flow/`** (13 requests). Select the **Local**
> environment and **Run** the folder top-to-bottom — each request captures the
> ids/tokens the next one needs, and globally-unique fields are randomized per run
> so it is re-runnable. It is the click-to-validate equivalent of the script below.

A runnable sequence from a fresh DB to a ready `business_admin` with one branch,
staff user, and a lab test. Paste into a shell after `pnpm start:dev`.

```bash
BASE=http://localhost:3000/api/v1

# 1. SiteAdmin login
SA_TOKEN=$(curl -s -X POST "$BASE/siteadmin/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@kalnostics.com","password":"SuperSecret1"}' \
  | jq -r '.data.accessToken')

# 2. Create tenant + business_admin  (capture phone + temp password from the response)
TENANT=$(curl -s -X POST "$BASE/siteadmin/tenants" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $SA_TOKEN" \
  -d '{"name":"Acme Diagnostics","slug":"acme-diagnostics","adminFirstName":"Alice",
       "adminPhone":"+919812345675","adminEmail":"alice.admin@acme.test","mrnPrefix":"AC"}')
ADMIN_PHONE=$(echo "$TENANT" | jq -r '.data.adminPhone')
TEMP_PW=$(echo "$TENANT"     | jq -r '.data.tempPassword')

# 3. Business login → business_admin token
BIZ_TOKEN=$(curl -s -X POST "$BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"identifier\":\"$ADMIN_PHONE\",\"password\":\"$TEMP_PW\",\"tenantSlug\":\"acme-diagnostics\"}" \
  | jq -r '.data.accessToken')

# 4. Create branch
BRANCH_ID=$(curl -s -X POST "$BASE/branches" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $BIZ_TOKEN" \
  -d '{"name":"Kothrud Main Lab","branchType":"DIAGNOSTIC","city":"Pune"}' \
  | jq -r '.data.id')

# 5. Enable modules on the branch  (REQUIRED before users)
curl -s -X PUT "$BASE/branches/$BRANCH_ID/modules" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $BIZ_TOKEN" \
  -d '{"modules":[{"moduleKey":"lab_operations","isEnabled":true},{"moduleKey":"branch_admin","isEnabled":true}]}' >/dev/null

# 6. Create a staff user at that branch
USER_ID=$(curl -s -X POST "$BASE/users/manage" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $BIZ_TOKEN" \
  -d '{"employeeName":"Satyam Sharma","username":"satyam.sharma","dateOfBirth":"1995-04-12",
       "gender":"MALE","email":"satyam.sharma@acme.test","mobileNumber":"9812348678",
       "password":"Str0ng@Pass1","userType":"INTERNAL","status":"ACTIVE",
       "branches":[{"branchId":"'"$BRANCH_ID"'","roleKey":"branch_admin","moduleId":"branch_admin","isDefault":true,"branchStatus":"ACTIVE"}]}' \
  | jq -r '.data.person.id')

# 7. Resolve the admin's permissions for the FE
curl -s "$BASE/users/manage/me/permissions?branchId=$BRANCH_ID" \
  -H "Authorization: Bearer $BIZ_TOKEN" | jq '.data.allowed'
```

> On Windows PowerShell, replace `jq` extraction with
> `(... | ConvertFrom-Json).data.<field>` and use `Invoke-RestMethod`.

---

## 9. Source of truth

- Endpoint shapes: `kalnostics-new/bruno/` (per-request `.bru` files + their `docs`).
- Runnable end-to-end setup flow: `kalnostics-new/bruno/00 Setup Flow/` (run the folder).
- Full endpoint + authorization reference: `kalnostics-new/docs/api.html`.
- Auth contracts & multi-tenant/branch rules: `CLAUDE.md` §4–§5 (canonical in `Master/`).
- Keep this doc in sync with the Bruno collection whenever an API changes.
