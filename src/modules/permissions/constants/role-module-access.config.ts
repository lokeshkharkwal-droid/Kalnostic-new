import { ProfileKey } from './profile-registry.constant';
import { SYSTEM_MODULE_KEYS } from './system-modules.constant';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  ROLE → MODULE CONFIG  (single source of truth — edit this file)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * This config maps roles to modules for TWO **independent** concerns. Keeping
 * them separate is what lets "which modules a role may be ASSIGNED" open up to
 * everything without touching "which permissions a role holds by default".
 *
 * 1) ASSIGNMENT ACCESS — {@link allowedModulesForRole}
 *    Which modules may be ASSIGNED to a user holding a role (the checkboxes on
 *    the "Assigned Branches, Roles and Modules" screen). **Every role may be
 *    assigned EVERY available module** — role selection no longer restricts the
 *    offered/accepted modules. Used by:
 *      - `GET /users/manage/roles` (so the screen offers the full catalogue), and
 *      - the users service (`assertModuleAssignableToRole`) so the same rule is
 *        enforced server-side (defence in depth).
 *
 * 2) BASELINE / DEFAULT MODULES — {@link ROLE_BASELINE_MODULES}
 *    The per-role module set whose permissions make up a role's **baseline
 *    permission grant**, and which also serves as the module-access **fallback**
 *    for a profile that has no explicitly-assigned modules (legacy/tenant-level
 *    rows — see `resolveEffectiveModules` / `ROLE_DEFAULT_MODULES`). This is a
 *    permissions concern and is deliberately UNCHANGED by opening assignment up:
 *    broadening assignment must never silently broaden any role's permissions.
 *
 * HOW TO EDIT
 *  - Keys are role (profile) keys from `profile-registry.constant.ts`.
 *  - Values are module keys from `system-modules.constant.ts`.
 *  - To change a role's default *permissions*, edit {@link ROLE_BASELINE_MODULES}.
 *  - Assignment access is intentionally unrestricted; see {@link allowedModulesForRole}.
 *
 * @see system-modules.constant.ts  — the master module catalogue (module keys)
 * @see profile-registry.constant.ts — the role (profile) catalogue (role keys)
 */

/**
 * Per-role BASELINE (default) modules. A role's baseline permission set is the
 * expansion of these modules, and they are the module-access fallback for a
 * profile with no explicitly-assigned modules. Consumed by
 * `module-permissions.constant.ts` as `ROLE_DEFAULT_MODULES`.
 *
 * THE EMPTY-ARRAY RULE
 *  - An **empty array** means the role has no baseline modules of its own; such a
 *    role's access follows the per-user module selection (e.g. `doctor`,
 *    `chemist`). It does NOT restrict what may be assigned — assignment is
 *    governed by {@link allowedModulesForRole}, which is unrestricted.
 */
export const ROLE_BASELINE_MODULES: Record<ProfileKey, string[]> = {
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
  // B2B Referral Panel login — the three modules whose screens the panel may see.
  // The baseline is narrowed to five navigation keys in module-permissions.constant.ts.
  b2b_referring_panel: ['registration', 'finance', 'lab_operations'],
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
 * The module keys a role may be **assigned**. Every role may be assigned EVERY
 * available module — role selection does not restrict the module list anymore.
 * Returns the full master module catalogue for any role (including unknown /
 * tenant custom roles). The branch's own enablement (`assertModulesValidForBranch`)
 * remains the real limiter on what can actually be assigned at a given branch.
 */
export function allowedModulesForRole(_roleKey: string): string[] {
  return [...SYSTEM_MODULE_KEYS];
}
