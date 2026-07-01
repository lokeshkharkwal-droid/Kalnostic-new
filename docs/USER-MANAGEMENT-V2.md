# User Management v2.0 — Developer Guide

> Status: implemented. Source of truth for the data model and rules is the code
> referenced throughout; this document explains it. Canonical project rules live
> in `../CLAUDE.md`; the terse changelog is `MIGRATION-PLAN.md §9`.

This guide covers what User Management v2.0 is, how to use it, and how
**different roles per branch** work (Part C).

---

## TL;DR mental model

- A human is **one `Person`** across the whole platform (one global identity).
- Inside a tenant (a business), that person has **one employment record** —
  `TenantStaffMembership` — which holds their **`userCode` (USR-00001)**, an
  **optional primary role** (`roleKey`, may be `null`), and a **tenant-global
  on/off switch** (`status`).
- The person is **assigned to one or more branches** via `UserBranchProfile`. Each
  branch assignment carries its **own role** (`profileKey`), an optional **module**
  (`defaultModuleId`), an **on/off switch** (`branchStatus`), and a **default flag**
  (`isDefault`). **One role per branch** — but the role can differ across branches.
- **Registration is decoupled from roles:** you can create a user with just basic
  details (no role), then assign role + module per branch later.
- A **role template** (predefined in code) bundles **two independent lists**: the
  **permissions** it grants and the **modules** it is linked to (the module link is
  optional). Per-(user+branch) `UserBranchPermission` rows then override the
  baseline.
- **Branches decide which modules they run** via `BranchModule`; permissions only
  exist for enabled modules.

---

# Part A — What it is

## A.1 Two-tier identity

| Tier | Model | Scope | What it holds |
| ---- | ----- | ----- | ------------- |
| Platform | `Person` | global (no `tenantId`) | the human's identity — name, DOB, contacts, Aadhaar/PAN, `platformMrn` |
| Tenant | `TenantStaffMembership` | one per `(tenant, person)` | employment facts — `userCode`, `userType`, optional `roleKey`, global `status` |
| Branch | `UserBranchProfile` | one per branch assignment | `profileKey` (the per-branch role), `branchStatus`, `defaultModuleId`, `isDefault` |

A `Person` can work for more than one tenant. Deactivating a user at Tenant A must
never disable them at Tenant B — so the on/off switch lives on the **membership**,
not the `Person`.

## A.2 The data model

All models below are in `prisma/schema.prisma`.

### `Person` (platform-level)

The global identity record. v2.0 staff-identity fields (all nullable, so existing
patient records are unaffected):

| Field | Notes |
| ----- | ----- |
| `platformMrn` | unique global id, e.g. `KAL-YYYYMMDD-XXXXXXXX` (immutable) |
| `firstName` | the staff member's name is stored here (`employeeName` → `firstName`) |
| `dateOfBirth`, `gender`, `bloodGroup` | basic demographics |
| `phone`, `email` | **globally-unique de-dup keys**, locked after first use |
| `nationality` | defaults to `"Indian"` |
| `fatherName`, `motherName` | v2.0 |
| `aadhaarNumber` | v2.0 — **encrypted at rest** (AES-256-GCM via `EncryptionService`); masked on read |
| `panNumber` | v2.0 — stored uppercase, format `AAAAA9999A` |
| `emergencyContactName`, `emergencyContactNumber` | v2.0 |
| `ownerTenantId` | the tenant that first registered them; `NULL` = self-registered patient |
| `isPatient`, `isStaff`, `isActive` | flags |

### `TenantStaffMembership` (tenant-scoped)

One row per `(tenant, person)` — enforced by `@@unique([tenantId, personId])`.

| Field | Notes |
| ----- | ----- |
| `userCode` | system-generated `USR-00001`, sequential per tenant from `Tenant.staffCounter`, immutable |
| `userType` | `INTERNAL` \| `EXTERNAL` |
| `roleKey` | **optional** primary/default role (`String?`). Informational — the authoritative role is per-branch. May be `null` (user has no role yet). |
| `status` | `ACTIVE` \| `INACTIVE` — **tenant-global** account switch |

### `UserBranchProfile` (tenant-scoped, branch-level) — the junction

One row per branch assignment (or one tenant-level row when `branchId = NULL`).
This is the user↔branch↔role↔module junction.

| Field | Notes |
| ----- | ----- |
| `branchId` | the branch; `NULL` = tenant-level profile (e.g. `business_admin`) |
| `profileKey` | **the role at this branch** — set per assignment (independent across branches) |
| `defaultModuleId` | the module linked to this assignment (the API field is `moduleId`); must be enabled for the branch |
| `branchStatus` | `ACTIVE` \| `INACTIVE` — **per-branch** switch (this branch only) |
| `isDefault` | exactly one per person — the JWT landing profile |
| `isActive` | soft-revoke (`false` = revoked); `revokedAt` / `revokedBy` trail |

> **One role per branch** is enforced by a partial unique index
> `ubp_person_branch_active_unique` on `(tenant_id, person_id, branch_id)` WHERE
> `deleted_at IS NULL AND is_active = true` (in `prisma/rls.sql`). NULL `branch_id`
> (tenant-level) rows are exempt.

### `BranchModule` (tenant-scoped)

Which of the 12 `SYSTEM_MODULES` a branch runs. Unique on `(branchId, moduleKey)`.
`isEnabled` gates the permission modal and the per-assignment module choice.

### `UserBranchPermission` (tenant-scoped, v2.0)

Module-grouped permission overrides per `(user + branch)`. Unique on
`(tenantId, personId, branchId, permissionKey)`.

| Field | Notes |
| ----- | ----- |
| `moduleKey` | one of the 14 modules |
| `permissionKey` | e.g. `lab_operations:verify` |
| `allowed` | `true` = grant, `false` = deny. **No row = inherit the role baseline.** |

### `UserProfilePermissionOverride` (legacy — unused)

The pre-v2.0 flat override table. Retained in the schema for now but **no longer
written or read** (its endpoints were removed — see Part B). Plan to drop.

### Relationship diagram

```
                         Person  (platform: one human, global)
                           │  isStaff, platformMrn, name, contacts, Aadhaar…
                           │
              ┌────────────┴───────────────┐  one membership per tenant
              ▼                             ▼
   TenantStaffMembership            (… at another tenant …)
     userCode  USR-00001
     roleKey   null | "doctor"  ◄── OPTIONAL primary role (informational)
     status    ACTIVE/INACTIVE (global switch)
              │
              │  one UserBranchProfile per branch (one role per branch)
     ┌────────┼─────────────────┐
     ▼        ▼                  ▼
  Branch A  Branch B        (tenant-level, branchId = NULL)
  profileKey= doctor   profileKey= branch_admin   ◄── roles DIFFER per branch
  moduleId  = lab_operations  moduleId = null
  branchStatus ACTIVE  branchStatus ACTIVE
  isDefault = true     isDefault = false

  Permissions per (user + branch):
     baseline = ROLE_TEMPLATES[<that branch's profileKey>].permissions
        then overridden by UserBranchPermission rows (allow/deny)
        but only for modules where BranchModule.isEnabled = true
```

### Enums (Prisma)

- `UserType` — `INTERNAL`, `EXTERNAL`
- `StaffStatus` — `ACTIVE`, `INACTIVE` (used for **both** global and per-branch)
- `Gender` — `MALE`, `FEMALE`, `OTHER`, `PREFER_NOT_TO_SAY`
- `BloodGroup` — `A_POS`, `A_NEG`, `B_POS`, `B_NEG`, `O_POS`, `O_NEG`, `AB_POS`, `AB_NEG`, `UNKNOWN`
- `BranchType` — `DIAGNOSTIC`, `RADIOLOGY`, `OPD`, `IPD`, `PHARMACY`, `INVENTORY`, `BLOOD_BANK`, `FRANCHISE`, `COMBINED`, `ASSISTANT`, `ACCESSION`, `TECHNICIAN`

## A.3 Roles, modules & permissions

Three constant files in `src/modules/permissions/constants/`:

### Roles — `profile-registry.constant.ts`

- `PROFILE_REGISTRY` — the predefined role keys (6 original + v2.0 roles such as
  `junior_lab_technician`, `consultant_doctor`, `phlebotomist`, `chemist`,
  `finance_manager`, …).
- `STAFF_ROLE_KEYS` — everything except `patient`; what the role inputs validate against.
- `PROFILE_BRANCH_MATRIX` — **which branch types each role is valid at.** Empty array
  = tenant-level (no branch), e.g. `business_admin`, `administrator`. Example:
  `doctor` → `OPD`, `IPD`, `DIAGNOSTIC`; `chemist` → `PHARMACY`, `COMBINED`.
- `isProfileValidForBranch(profileKey, branchType)` and `isValidProfileKey(key)`.

### Modules — `system-modules.constant.ts`

The 14 master modules: `registration`, `accession`, `lab_operations`, `inventory`,
`sales`, `admin`, `radiology`, `pharmacy`, `opd`, `ipd`, `finance`, `phlebotomist`,
`assistant`, `operation`.

### Role templates & permissions — `module-permissions.constant.ts`

- `MODULE_PERMISSION_CATALOG` — fine-grained permissions, each tagged with its
  `moduleKey` and a stable `permissionKey` (e.g. `lab_operations:verify`).
- `ROLE_TEMPLATES: Record<ProfileKey, { permissions: string[]; modules: string[] }>`
  — each role template carries **two independent lists**: the permissions it grants
  and the modules it links to. `modules` may be empty (a template not linked to any
  module). Templates are seeded so `permissions` = the expansion of their linked
  modules, but the two lists are independent and editable separately.
- `roleBaselinePermissions(roleKey)` → the template's permission set.
- `roleTemplateModules(roleKey)` → the template's linked modules (may be empty).

### Two independent status layers

| Layer | Field | Effect |
| ----- | ----- | ------ |
| Global | `TenantStaffMembership.status` | `INACTIVE` blocks login to the **whole tenant** |
| Per-branch | `UserBranchProfile.branchStatus` | `INACTIVE` blocks **only that branch**; global wins if it is INACTIVE |

Enforcement: `AuthService.login` rejects an `INACTIVE` membership; `buildJwtPayload`
and `switchProfile` exclude `INACTIVE`-branch profiles.

## A.4 How permissions resolve

`UsersService.getBranchPermissions(tenantId, personId, branchId)`:

1. Load the user's **`UserBranchProfile` for that branch** → its `profileKey` (the
   role at this branch). No profile → return `[]`.
2. Get the **enabled** modules for the branch (`BranchModule` where `isEnabled`).
3. Compute the baseline = `roleBaselinePermissions(profile.profileKey)` — i.e. the
   role **assigned at that branch**.
4. Load `(user + branch)` overrides from `UserBranchPermission`.
5. For every catalogue entry in an enabled module: `allowed = override ?? baseline`.

**Worked example.** A user is `doctor` at Branch A and `branch_admin` at Branch B.
At Branch A the baseline is the doctor template's permissions; at Branch B it is the
branch_admin template's — *the same user resolves different permissions per branch*,
because the baseline comes from the branch's own role.

---

# Part B — How to use it (API)

All endpoints live on `UserManagementController`, mounted at **`/users/manage`**.
Business-authenticated; `tenantId` and the actor `person_id` come from the JWT,
never the body. Responses use the global `{ success, data, meta }` envelope.

> The pre-v2.0 `users` controller (patient registration, person update, legacy
> profile assignment & permission overrides, receptionist↔doctor mapping) has been
> **removed**. Use `/users/manage` for all staff-user management.

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `POST` | `/users/manage` | Create a staff user (role optional) |
| `GET` | `/users/manage` | List users (paginated, filterable, sortable) |
| `GET` | `/users/manage/:id` | Full detail for one user (Aadhaar masked) |
| `PATCH` | `/users/manage/:id` | Edit identity / password / primary role / global status |
| `POST` | `/users/manage/:id/photo` | Upload/replace photo (JPG/JPEG/PNG ≤ 2 MB) |
| `POST` | `/users/manage/:id/branches` | Bulk assign/update branch assignments |
| `PATCH` | `/users/manage/:id/branches/:branchId` | Patch one branch assignment |
| `PATCH` | `/users/manage/:id/activate` & `/deactivate` | Global status |
| `GET\|PUT` | `/users/manage/:id/branch-permissions` | Resolve / replace (user+branch) overrides |
| `GET` | `/users/manage/roles`, `/modules`, `/permissions` | Catalogues / permissions screen |

Branch→module enablement is on the **branch** module: `GET|PUT /branches/:id/modules`.

### Create a user — `POST /users/manage`

```jsonc
{
  "employeeName": "Asha Rao",
  "username": "asha.rao",
  "dateOfBirth": "1990-04-12",
  "gender": "FEMALE",
  "email": "asha@example.com",        // globally unique
  "mobileNumber": "9876543210",       // 10-digit Indian mobile; globally unique
  "password": "Str0ng@Pass",          // 8+ chars: upper, lower, digit, special
  "userType": "INTERNAL",
  // roleKey is OPTIONAL (primary role). Omit to create a user with no role.
  "branches": [                        // optional initial assignments
    { "branchId": "<uuid>", "roleKey": "lab_technician",
      "moduleId": "lab_operations", "isDefault": true, "branchStatus": "ACTIVE" }
  ]
}
```

Returns `{ person, membership, userCode, loginIdentifier }`.

### Register with no role, assign later

Omit `roleKey` **and** `branches` → a tenant member with a null role. Then:

### Assign branches — `POST /users/manage/:id/branches`

The body is the **array of objects** you map to the user:

```jsonc
{ "branches": [
  { "branchId": "<branch-A>", "roleKey": "doctor",       "moduleId": "lab_operations", "isDefault": true },
  { "branchId": "<branch-B>", "roleKey": "branch_admin", "branchStatus": "ACTIVE" }
] }
```

Each item is `{ branchId, roleKey, moduleId? }` (+ optional `isDefault`,
`branchStatus`). One role per branch — an existing branch assignment is re-roled in
place. Exactly one item may be `isDefault: true`. Each `roleKey` must be valid for
that branch's type; `moduleId` must be enabled for the branch (and linked to the
role template, when it links any).

### Patch one branch — `PATCH /users/manage/:id/branches/:branchId`

```jsonc
{ "roleKey": "receptionist", "branchStatus": "INACTIVE", "isDefault": false, "moduleId": "registration" }
```

All fields optional, including changing just that branch's `roleKey`.

### Read & set permissions

`GET /users/manage/:id/branch-permissions?branchId=<uuid>` → per enabled module,
rows of `{ moduleKey, moduleLabel, permissionKey, label, baseline, allowed }`
(baseline from **that branch's** role).

`PUT /users/manage/:id/branch-permissions` replaces the full set for a branch:

```jsonc
{ "branchId": "<uuid>", "items": [
  { "moduleKey": "lab_operations", "permissionKey": "lab_operations:verify", "allowed": false }
] }
```

### Common task walkthrough

1. `GET /users/manage/roles` and `/modules` to populate dropdowns.
2. `POST /users/manage` (with or without a role).
3. `POST /users/manage/:id/branches` with the `{ branchId, roleKey, moduleId }`
   array; set one branch as default.
4. Ensure the branch runs the modules you need: `PUT /branches/:id/modules`.
5. `PUT /users/manage/:id/branch-permissions` to tune one branch's capabilities.
6. `PATCH …/branches/:branchId` with `branchStatus: INACTIVE` to suspend one
   branch, or `/deactivate` for the whole account.

### Notes

- **Password policy (v2.0):** admin-set passwords require a special character
  (stronger than `CLAUDE.md §5.3`). Self-service change-password & temp passwords
  unchanged.
- **Env vars:** `ENCRYPTION_KEY` (64 hex) is required to store Aadhaar; uploads use
  `UPLOAD_DIR`.
- `username`, `email`, and `userCode` are **immutable** after creation.

---

# Part C — Different roles in different branches (how it works)

This is the core of v2.0's role model, now implemented.

## C.1 The shape

- The role lives on each `UserBranchProfile.profileKey` row — **one per
  (user, branch)**, set independently. `TenantStaffMembership.roleKey` is only an
  optional primary/default and is **never** propagated to branch profiles.
- The frontend sends, per user, an array of `{ branchId, roleKey, moduleId }`
  (Assign Branches). Each maps to one branch profile row.
- A partial unique index enforces **one active role per (tenant, person, branch)**.

## C.2 Where it's enforced (code map)

- `BranchAssignmentItemDto` / `UpdateBranchAssignmentDto`
  (`src/modules/users/dto/`) carry per-item `roleKey` (+ `moduleId`).
  `CreateUserDto.roleKey` is optional.
- `users.service.ts`:
  - `prepareBranchAssignments(tenantId, fallbackRoleKey, items)` — resolves each
    item's role (`item.roleKey ?? fallback`), validates it for the branch type
    (`isProfileValidForBranch`) and the module (enabled + linked to the template).
  - `createUser` / `assignBranches` — write each profile's `profileKey` from its own
    item; `assignBranches` matches existing rows by `(tenant, person, branch)` and
    re-roles in place (one role per branch).
  - `updateBranchAssignment` — can change a single branch's `roleKey`.
  - `updateUser` — updates only the membership's optional primary role; **no**
    propagation to branch profiles.
  - `getBranchPermissions` — resolves the baseline from the branch's `profileKey`.
- `prisma/schema.prisma` — `TenantStaffMembership.roleKey String?`.
- `prisma/rls.sql` — `ubp_person_branch_active_unique` partial unique index.

## C.3 Role templates (independent permissions + modules)

`ROLE_TEMPLATES` in `module-permissions.constant.ts` defines, per role, two
independent lists: `permissions` and `modules`. A template's module link is
optional (`modules` may be empty). At assignment, if a role template links specific
modules, the chosen `moduleId` must be one of them (else
`MODULE_NOT_IN_ROLE_TEMPLATE`); templates with no linked modules accept any
branch-enabled module.

## C.4 Edge cases

- **One role per branch** (not two at the same branch) — different roles allowed
  across branches.
- **List display:** the user list's `role` column shows the membership's primary
  role, falling back to the default branch's role; the `?role=` filter matches any
  of the user's branch roles.
- **Migration impact:** existing rows keep their role; any pre-existing duplicate
  active (person, branch) rows had to be consolidated to satisfy the new index.

---

## Source map

| Topic | File |
| ----- | ---- |
| Models & enums | `prisma/schema.prisma` |
| One-role-per-branch index | `prisma/rls.sql` (`ubp_person_branch_active_unique`) |
| Roles + branch matrix | `src/modules/permissions/constants/profile-registry.constant.ts` |
| Modules | `src/modules/permissions/constants/system-modules.constant.ts` |
| Role templates + permissions | `src/modules/permissions/constants/module-permissions.constant.ts` |
| Endpoints | `src/modules/users/user-management.controller.ts` |
| Service logic | `src/modules/users/users.service.ts` |
| DTOs | `src/modules/users/dto/` |
| JWT payload | `src/modules/auth/` (`auth.service.ts`, `types/jwt-payload.type.ts`) |
| API requests | `bruno/06 Users/User Management v2/` |
| Changelog | `MIGRATION-PLAN.md §9` |
