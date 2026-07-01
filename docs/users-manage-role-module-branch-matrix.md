# `POST /users/manage` — Role × Branch-Type × Module Reference

> Why a `Create User` call gets rejected, and the exact `roleKey` / `moduleId` /
> branch combinations the endpoint will accept.
>
> Source of truth in code:
> - `src/modules/permissions/constants/profile-registry.constant.ts` → `PROFILE_BRANCH_MATRIX`
> - `src/modules/permissions/constants/module-permissions.constant.ts` → `ROLE_DEFAULT_MODULES` / `ROLE_TEMPLATES`
> - `src/modules/permissions/constants/system-modules.constant.ts` → `SYSTEM_MODULES`
> - `src/modules/users/users.service.ts` → `prepareBranchAssignments()`

> ⚠️ **Update (branch-type restriction lifted).** As of the latest change, the
> per-branch-type role check is **no longer enforced**: **any branch-level role can
> be assigned to any branch type** on `POST /users/manage`,
> `POST /users/manage/:id/branches`, and `PATCH /users/manage/:id/branches/:branchId`.
> So the `PROFILE_INVALID_FOR_BRANCH` "not valid for branch type" rejection
> described below **no longer occurs**. The `PROFILE_BRANCH_MATRIX` table in §3 is
> now **advisory only** (intended mapping), not a hard gate. Two restrictions
> remain: **tenant-level** roles (`business_admin`, `administrator`, `patient`)
> still cannot be pinned to a branch, and the **module** checks (§2, 3a/3b) still
> apply.

---

## 1. The error you hit

```json
{
  "success": false,
  "error": {
    "code": "PROFILE_INVALID_FOR_BRANCH",
    "message": "Profile 'lab_technician' is not valid for branch type 'COMBINED'"
  }
}
```

**Root cause.** Each `branches[].roleKey` must be allowed at the *type* of the
branch you assign it to. The matrix says:

```
lab_technician → [ DIAGNOSTIC, IPD ]
```

The branch `ccfc4bda-5936-4358-9187-772dd01fc8e5` is type **`COMBINED`**, which
is **not** in that list → rejected. The legacy `lab_technician` role predates the
`COMBINED` branch type and was never added to it. Its v2.0 successors
(`junior_lab_technician` / `senior_lab_technician`) **are** valid for `COMBINED`.

This check fires **before** the module checks, so `moduleId: "lab_operations"`
was never reached — but note it would have passed (it is in the lab-tech role
template).

---

## 2. The validations every `branches[]` item passes

`prepareBranchAssignments()` runs these in order — the first failure wins.
**Check #2 (branch-type) has been removed** — kept in the table struck through for
history:

| # | Check | Exception code | Rule |
|---|-------|----------------|------|
| 1 | Role is branch-level (not tenant-level) | `PROFILE_INVALID_FOR_BRANCH` | `business_admin` / `administrator` / `patient` cannot go in `branches[]` |
| ~~2~~ | ~~Role valid for the branch's `branchType`~~ | ~~`PROFILE_INVALID_FOR_BRANCH`~~ | **Removed — no longer enforced.** Any branch-level role works on any branch type. |
| 3a | `moduleId` is a real module **and enabled** on that branch | `INVALID_MODULE_KEY` / `MODULE_NOT_ENABLED_FOR_BRANCH` | branch must have a `BranchModule` row with `isEnabled = true` |
| 3b | `moduleId` is linked to the role's template | `MODULE_NOT_IN_ROLE_TEMPLATE` | must be in `ROLE_DEFAULT_MODULES[roleKey]` (templates with no modules accept any enabled one) |

The branch is still looked up (`BranchService.findById`) to confirm it belongs to
the caller's tenant — a client-supplied `branchId` from another tenant is rejected.

`moduleId` is optional — omit it and checks 3a/3b are skipped (the profile is
created with `defaultModuleId = null`). The active branch / tenant come from your
JWT; `branchId` in the body is validated against your tenant, never trusted blindly.

---

## 3. Branch-level role → valid branch types → assignable modules

`moduleId` must be one of the role's modules **and** enabled on the branch.

| `roleKey` | Valid branch types | Assignable `moduleId` (role template) |
|-----------|--------------------|---------------------------------------|
| `branch_admin` | DIAGNOSTIC, RADIOLOGY, OPD, IPD, PHARMACY, INVENTORY, BLOOD_BANK, FRANCHISE, **COMBINED**, COLLECTION_CENTER | *all 14 modules* |
| `doctor` | OPD, IPD, DIAGNOSTIC | registration, lab_operations, opd, radiology |
| `lab_technician` | DIAGNOSTIC, IPD | accession, lab_operations |
| `receptionist` | DIAGNOSTIC, OPD, IPD, PHARMACY, FRANCHISE, COLLECTION_CENTER | registration, sales, opd |
| `junior_lab_technician` | DIAGNOSTIC, IPD, BLOOD_BANK, TECHNICIAN, **COMBINED** | accession, lab_operations |
| `senior_lab_technician` | DIAGNOSTIC, IPD, BLOOD_BANK, TECHNICIAN, **COMBINED** | accession, lab_operations |
| `consultant_doctor` | OPD, IPD, DIAGNOSTIC, RADIOLOGY, **COMBINED** | opd, ipd, lab_operations, radiology |
| `reporting_doctor` | DIAGNOSTIC, RADIOLOGY, IPD, **COMBINED** | lab_operations, radiology |
| `phlebotomist` | DIAGNOSTIC, OPD, IPD, BLOOD_BANK, **COMBINED**, COLLECTION_CENTER | phlebotomist, accession |
| `marketing_executive` | DIAGNOSTIC, OPD, FRANCHISE, **COMBINED** | sales |
| `marketing_manager` | DIAGNOSTIC, OPD, FRANCHISE, **COMBINED** | sales, finance |
| `inventory_manager` | INVENTORY, PHARMACY, DIAGNOSTIC, **COMBINED** | inventory |
| `chemist` | PHARMACY, **COMBINED** | pharmacy |
| `chemist_assistant` | PHARMACY, **COMBINED** | pharmacy |
| `finance_manager` | DIAGNOSTIC, OPD, IPD, PHARMACY, FRANCHISE, **COMBINED** | finance, sales |
| `finance_assistant` | DIAGNOSTIC, OPD, IPD, PHARMACY, FRANCHISE, **COMBINED** | finance |
| `logistics_executive` | INVENTORY, ACCESSION, DIAGNOSTIC, **COMBINED** | inventory, accession |
| `opd_assistant` | OPD, **COMBINED** | opd, registration |
| `radiology_assistant` | RADIOLOGY, **COMBINED** | radiology |
| `nursing_staff` | OPD, IPD, **COMBINED** | opd, ipd |
| `nursing_incharge` | OPD, IPD, **COMBINED** | opd, ipd |

**Tenant-level roles** (`business_admin`, `administrator`, `patient`) have
`branchId = NULL` and **must not** appear in `branches[]` — they apply to the
whole tenant.

### Roles valid for a `COMBINED` branch (your case)

`branch_admin`, `junior_lab_technician`, `senior_lab_technician`,
`consultant_doctor`, `reporting_doctor`, `phlebotomist`, `marketing_executive`,
`marketing_manager`, `inventory_manager`, `chemist`, `chemist_assistant`,
`finance_manager`, `finance_assistant`, `logistics_executive`, `opd_assistant`,
`radiology_assistant`, `nursing_staff`, `nursing_incharge`.

> Per the matrix, `lab_technician`, `doctor`, and `receptionist` were **not**
> listed for `COMBINED` — but since the branch-type restriction is now lifted,
> they too can be assigned to a `COMBINED` branch.

---

## 4. The 14 system modules (`moduleId` values)

`registration`, `accession`, `lab_operations`, `inventory`, `sales`, `admin`,
`radiology`, `pharmacy`, `opd`, `ipd`, `finance`, `phlebotomist`, `assistant`,
`operation`.

---

## 5. Your original request now works

With the branch-type restriction lifted, the original payload
(`roleKey: "lab_technician"` on the `COMBINED` branch with
`moduleId: "lab_operations"`) is now accepted as-is — `lab_operations` is in the
lab-tech role template, so the only remaining requirement is that the module is
**enabled** on that branch (else `MODULE_NOT_ENABLED_FOR_BRANCH`).

If you prefer the semantically-intended role for a lab technician on a
**COMBINED** branch, `senior_lab_technician` / `junior_lab_technician` remain the
matrix-aligned choice and also keep `moduleId: "lab_operations"`.

```bash
curl --request POST \
  --url http://localhost:3000/api/v1/users/manage \
  --header 'authorization: Bearer <BUSINESS_JWT>' \
  --header 'content-type: application/json' \
  --data '{
  "employeeName": "Satyam",
  "username": "satyam.sharma2",
  "dateOfBirth": "1995-04-12",
  "gender": "MALE",
  "bloodGroup": "O_POS",
  "nationality": "Indian",
  "fatherName": "Ramesh Sharma",
  "motherName": "Sunita Sharma",
  "aadhaarNumber": "123456789012",
  "panNumber": "ABCDE1234F",
  "address": "12 MG Road, Bengaluru",
  "email": "anita.sharma2022@acme.test",
  "mobileNumber": "9812348670",
  "emergencyContactName": "Ramesh Sharma",
  "emergencyContactNumber": "9812300007",
  "password": "Str0ng@Pass1",
  "userType": "INTERNAL",
  "status": "ACTIVE",
  "branches": [
    {
      "branchId": "ccfc4bda-5936-4358-9187-772dd01fc8e5",
      "roleKey": "senior_lab_technician",
      "moduleId": "lab_operations",
      "isDefault": true,
      "branchStatus": "ACTIVE"
    }
  ]
}'
```

**Alternative:** keep `roleKey: "lab_technician"` but point `branchId` at a
**DIAGNOSTIC** or **IPD** branch instead of the COMBINED one.

> If you then hit `MODULE_NOT_ENABLED_FOR_BRANCH`, the branch is missing a
> `BranchModule` row for `lab_operations` — enable the module on that branch first
> (Branch→Module enablement), or drop `moduleId` from the assignment.
