import { ProfileKey } from './profile-registry.constant';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  ROLE → MODULE ACCESS CONFIG  (single source of truth — edit this file)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * This is the **configuration file** that maps every predefined role to the set
 * of system modules it is allowed to access. It is plain data — no database
 * table backs it (per the User Management v2.0 spec, role→module access is a
 * static configuration, not a DB mapping).
 *
 * WHERE IT IS USED
 *  - `GET /users/manage/roles` returns each role's allowed modules, so the
 *    frontend's "Assigned Branches and Modules" screen only offers the modules
 *    that are valid for the selected Default Role.
 *  - The users service validates every assigned module against this config
 *    (`assertModuleInRoleTemplate`) so an invalid role→module pairing is
 *    rejected server-side too (defence in depth — the UI restriction is not the
 *    only guard).
 *
 * HOW TO EDIT
 *  - Keys are role (profile) keys from `profile-registry.constant.ts`.
 *  - Values are module keys from `system-modules.constant.ts`.
 *  - Add/remove a module key from a role's array to change what that role may
 *    access. No UI or service code needs to change.
 *
 * THE EMPTY-ARRAY RULE
 *  - An **empty array** means "no module restriction": the role may be assigned
 *    ANY module the branch has enabled. Use this for roles whose module set is
 *    not yet fixed (e.g. `doctor`, `chemist`). To lock a role down, list its
 *    modules explicitly.
 *
 * @see system-modules.constant.ts  — the master module catalogue (module keys)
 * @see profile-registry.constant.ts — the role (profile) catalogue (role keys)
 */
export const ROLE_MODULE_ACCESS: Record<ProfileKey, string[]> = {
  // The two admin roles map 1:1 to their console module, whose permission set is
  // the full API resource catalogue (see ADMIN_CONSOLE_MODULE_KEYS) — so both
  // roles' baselines expand to every API resource permission.
  business_admin: ['business_admin'],
  branch_admin: ['branch_admin'],
  administrator: allAccessModules(),
  patient: [],
  doctor: [],
  consultant_doctor: [],
  reporting_doctor: [],
  lab_technician: ['accession', 'lab_operations'],
  junior_lab_technician: ['accession', 'lab_operations'],
  senior_lab_technician: ['accession', 'lab_operations'],
  receptionist: ['sales', 'registration'],
  phlebotomist: ['phlebotomist', 'accession'],
  marketing_executive: ['sales'],
  marketing_manager: ['sales', 'finance'],
  inventory_manager: ['inventory'],
  chemist: [],
  chemist_assistant: [],
  finance_manager: ['finance', 'sales'],
  finance_assistant: ['finance'],
  logistics_executive: ['inventory', 'accession'],
  opd_assistant: [],
  radiologist: ['radiology'],
  radiology_assistant: [],
  nursing_staff: [],
  nursing_incharge: [],
};

/**
 * The modules the all-access `administrator` role may reach — every
 * permission-bearing **operational / feature-area** module (i.e. all modules
 * except the two admin consoles). Kept as a helper so the administrator entry
 * automatically picks up newly-permissioned feature areas.
 */
function allAccessModules(): string[] {
  return [
    'accession',
    'inventory',
    'sales',
    'finance',
    'phlebotomist',
    'assistant',
    'operation',
    'registration',
    'lab_operations',
  ];
}

/**
 * The module keys a role is allowed to access. An **empty array** means the role
 * has no module restriction (any branch-enabled module is allowed) — see the
 * empty-array rule above. Unknown roles (e.g. tenant custom roles) return `[]`.
 */
export function allowedModulesForRole(roleKey: string): string[] {
  return ROLE_MODULE_ACCESS[roleKey as ProfileKey] ?? [];
}
