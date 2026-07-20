# Kalnostics New — Bruno API Collection

A ready-to-run [Bruno](https://www.usebruno.com/) collection for the Kalnostics
New NestJS backend. Every endpoint, with example bodies, auth wired up, and
post-response scripts that automatically capture tokens / ids into environment
variables so you can run the whole flow end-to-end.

## Open it in Bruno

This is a **native Bruno collection** (not an export to import):

1. Open Bruno → **Open Collection**.
2. Select this `bruno/` folder.
3. Top-right environment selector → choose **Local**
   (`baseUrl = http://localhost:3000/api/v1`).

> Bruno's "Import Collection" expects a single file (OpenAPI / Postman / Insomnia).
> Use **Open Collection** here instead — it's the native, fully-featured path.

## Start the backend first

```powershell
cd kalnostics-new
pnpm install
pnpm prisma migrate deploy   # or: pnpm prisma db push
pnpm prisma db seed          # seeds the super_owner SiteAdmin
pnpm start:dev
```

Seeded SiteAdmin login: `admin@kalnostics.com` / `SuperSecret1`.

## Run order (the scripts chain everything for you)

| # | Folder / Request | Captures |
|---|------------------|----------|
| 1 | **01 SiteAdmin Auth → Login** | `siteAdminToken` |
| 2 | **03 Tenants → Create Tenant** | `tenantId`, `tenantSlug`, `adminPhone`, `adminTempPassword` |
| 3 | **04 Business Auth → Login** | `businessAccessToken`, `businessRefreshToken` |
| 4 | **05 Branches → Create Branch** | `branchId` |
| 5 | **06 Users → Register Patient / Register Staff** | `patientPersonId`, `staffPersonId`, `staffTempPassword` |
| 6 | **05 Branches → Set Branch Modules** | — (enables work-area modules for the branch) |
| 7 | **05 Branches → Create Collection Center** | `collectionCenterId` (maps `branchId` as a sample receiver; optional) |
| 8 | **06 Users → User Management v2 → Create User** | `manageUserId`, `manageUserCode` |
| 9 | everything else (incl. Get/Set Collection Mappings) | — |

If a capture script can't find a field (the exact response shape may differ),
just open the response, copy the value, and paste it into the matching
**Local** environment variable by hand.

## End-to-end flows (self-contained, Run-Folder friendly)

Two folders are complete, top-to-bottom runs — each request feeds the ids/tokens
it captures into the next, so you can **Run Folder** with the **Local**
environment and no manual edits:

- **47 Order Flow (E2E)** — Business Login → catalogue → branch import → master
  records → patient → **Create Order (every field)**. The exhaustive order
  contract.
- **48 Create User Flow (E2E)** — Admin Login → enable branch modules → **create
  an order-capable user** (`receptionist` + `sales` permissions) → **log in as
  that new user** → **Registration** phase (register patient → create order) run
  *as the new user*. Proves a freshly-provisioned account can do front-desk work
  end-to-end. Prereq: the branch has an imported catalogue (run 47 once first if
  empty).

## How it's wired

- **Global prefix** `/api/v1` (from `src/main.ts`).
- **Response envelope** `{ success, data, meta }` — scripts read `res.getBody().data`.
- **Business routes** use `Authorization: Bearer {{businessAccessToken}}`.
- **SiteAdmin routes** use `Authorization: Bearer {{siteAdminToken}}`.
  The two tokens are NOT interchangeable.

## Endpoint coverage

- **Business auth** (`/auth`): login, refresh, me, switch-profile,
  change-password, logout
- **SiteAdmin auth** (`/siteadmin/auth`): login
- **SiteAdmin users** (`/siteadmin`): me, create, list, change-password,
  deactivate
- **Tenants** (`/siteadmin/tenants`): create, list, get, update, get-admin,
  reset-admin-password
- **SiteAdmin roles** (`/siteadmin/roles`): manage the **global** role catalogue
  (`tenant_id = null`) — list, create, get, update. Built-in (`isSystem`) roles are
  description/status-only; SiteAdmin-created global roles are fully editable and
  available to all tenants. `master-data:read`/`write` (content_admin+).
- **Branches** (`/branches`): create (incl. Collection Center with inline
  `receivingBranchIds`), list, get, update, delete, get/set modules (work-area
  enablement), get/set collection-center sample-receiving mappings
- **Users** (`/users`): register-patient, list-staff, register-staff, get,
  update, assign/revoke/default profile, get/set permissions, get/set
  receptionist-doctors, reset-password
- **User Management v2** (`/users/manage`): create / list / get / update user,
  upload profile photo, assign branches, update branch assignment, global
  deactivate / activate, get / update branch permissions, **get my permissions
  (`me/permissions`)**, **get permission catalog (`permission-catalog`)**, list
  profile permissions, list roles (built-in catalogue), list modules
- **Roles** (`/roles`): list (system + tenant custom), create / get / update /
  delete a tenant **custom** role. Roles are a first-class entity (`AuthRole`):
  the 24 built-in **system** roles are seeded and have immutable `name`/`key`
  (only `description`/`isActive` are editable); tenants define their own custom
  roles here. `roleKey`/`profileKey` in other requests resolve to one of these.
- **Patients** (`/patients`): list, get (with medical histories), create (with
  optional nested `medicalHistories`), update, delete (cascade soft-delete).
  Tenant-scoped + branch-level (registration branch from the JWT); duplicate
  active `mobile` per tenant → 409 `PATIENT_MOBILE_CONFLICT`.
- **Medical history** (`/patients/:patientId/medical-history`): add, list, get,
  update, delete — one-to-many per patient (boolean symptom/condition/medication/
  allergy flags + free-text notes).
- **Appointments** (`/appointments`): create (generates `APT-00001` + records the
  initial status), list (paginated; `search`/`status`/`appointmentType` filters),
  get (with status history), update-status (`PATCH /:id/status` — updates the
  current status AND appends a history row atomically), get-history
  (`GET /:id/history`), delete (soft). Tenant-scoped + branch-level; the current
  status lives on the appointment, every change on an append-only history log.

## Enum reference

- `Gender`: MALE, FEMALE, OTHER, PREFER_NOT_TO_SAY
- `BloodGroup`: A_POS, A_NEG, B_POS, B_NEG, O_POS, O_NEG, AB_POS, AB_NEG, UNKNOWN
- `Salutation`: DR, MR, MRS, MS, PROF
- `PatientCategory`: GENERAL, VIP, SENIOR_CITIZEN, PEDIATRIC, EMPLOYEE
- `MaritalStatus`: SINGLE, MARRIED, DIVORCED, WIDOWED, SEPARATED, OTHER
- `AgeType`: YEARS, MONTHS, DAYS
- `Relationship` (patient `relationship` / `guardianRelationship`): SELF, SPOUSE, SON, DAUGHTER, FATHER, MOTHER, BROTHER, SISTER, GUARDIAN, FRIEND, OTHER
- `BranchType`: DIAGNOSTIC, RADIOLOGY, OPD, IPD, PHARMACY, INVENTORY, BLOOD_BANK, FRANCHISE, COMBINED, ASSISTANT, ACCESSION, TECHNICIAN, COLLECTION_CENTER
- `SiteAdminRole`: CONTENT_ADMIN, OPERATIONS_ADMIN, FULL_ADMIN, SUPER_OWNER
- `AppointmentType`: DIAGNOSTIC, OPD, RADIOLOGY
- `AppointmentStatus`: NEW, CONFIRMED, CHECKED_IN, IN_PROGRESS, COMPLETED, CANCELLED, RESCHEDULED
- `UserType` (User Mgmt v2): INTERNAL, EXTERNAL
- `StaffStatus` (User Mgmt v2): ACTIVE, INACTIVE
- Role keys (`roleKey` / `profileKey`) — the **key** of an `AuthRole`. The seeded
  **system** roles: original — business_admin, branch_admin, doctor,
  lab_technician, receptionist, patient; v2 predefined — administrator,
  junior_lab_technician, senior_lab_technician, consultant_doctor,
  reporting_doctor, phlebotomist, marketing_executive, marketing_manager,
  inventory_manager, chemist, chemist_assistant, finance_manager,
  finance_assistant, logistics_executive, opd_assistant, radiology_assistant,
  nursing_staff, nursing_incharge. Tenants may also define **custom** role keys
  via `/roles` (auto-generated slug of the role name). Any request taking a
  `roleKey`/`profileKey` accepts either; an unknown key → 404 ROLE_NOT_FOUND.
- System modules (`moduleKey`): accession, inventory, sales, finance,
  phlebotomist, assistant, operation, business_admin, branch_admin, registration,
  lab_operations, patient_management, radiology, pharmacy. The subset **valid for a
  given branch** is branch-type dependent — see `GET /modules?branchType=…`
  (`BRANCH_MODULES`). A user's per-branch `modules` (User Mgmt v2 branch
  assignments) must come from that subset **and** be enabled on the branch.
- Permission keys (`permissionKey`): `module:action`. Every module exposes the
  four standard actions — `view`, `write`, `edit`, `delete` (e.g. `admin:view`,
  `inventory:write`) — plus domain-specific extras: `lab_operations:enter_results`,
  `lab_operations:verify`, `admin:manage_users`, `admin:manage_branches`,
  `admin:manage_permissions`, `radiology:report`, `radiology:verify`,
  `pharmacy:dispense`, `pharmacy:manage_stock`, `ipd:admit`, `ipd:discharge`,
  `finance:manage`, `finance:reports`, `phlebotomist:collect_sample`
