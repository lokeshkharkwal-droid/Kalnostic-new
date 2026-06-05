# Kalnostics New — Bruno API Collection

A ready-to-run [Bruno](https://www.usebruno.com/) collection for the Kalnostics
New NestJS backend. All 36 endpoints, with example bodies, auth wired up, and
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
| 6 | everything else | — |

If a capture script can't find a field (the exact response shape may differ),
just open the response, copy the value, and paste it into the matching
**Local** environment variable by hand.

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
- **Branches** (`/branches`): create, list, get, update, delete
- **Users** (`/users`): register-patient, list-staff, register-staff, get,
  update, assign/revoke/default profile, get/set permissions, get/set
  receptionist-doctors, reset-password

## Enum reference

- `Gender`: MALE, FEMALE, OTHER, PREFER_NOT_TO_SAY
- `BloodGroup`: A_POS, A_NEG, B_POS, B_NEG, O_POS, O_NEG, AB_POS, AB_NEG, UNKNOWN
- `BranchType`: DIAGNOSTIC, CLINIC, HOSPITAL, PHARMACY, COLLECTION_CENTER
- `SiteAdminRole`: CONTENT_ADMIN, OPERATIONS_ADMIN, FULL_ADMIN, SUPER_OWNER
- `ProfileKey`: business_admin, branch_admin, doctor, lab_technician,
  receptionist, patient
