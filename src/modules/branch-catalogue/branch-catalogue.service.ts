import { Injectable } from '@nestjs/common';
import {
  moduleGroup,
  moduleLabel,
  SYSTEM_MODULE_KEYS,
  type ModuleGroup,
} from '../permissions/constants/system-modules.constant';
import { BRANCH_MODULES } from './constants/branch-modules.constant';
import { InvalidBranchTypeException } from './exceptions/branch-catalogue.exceptions';

/**
 * Sort module keys by the canonical `SYSTEM_MODULES` order so every catalogue
 * response (navbar tabs via `GET /modules?branch_type=`, the branch module
 * picker, etc.) presents modules in the one predefined order — never the
 * service-line grouping order of `BRANCH_MODULES`. Unknown keys sort last.
 */
function byCanonicalOrder(a: string, b: string): number {
  const ia = SYSTEM_MODULE_KEYS.indexOf(a);
  const ib = SYSTEM_MODULE_KEYS.indexOf(b);
  return (
    (ia === -1 ? Number.MAX_SAFE_INTEGER : ia) -
    (ib === -1 ? Number.MAX_SAFE_INTEGER : ib)
  );
}

/**
 * A module offered by a branch type: its stable key, display label, and
 * service-line group (`common` / `diagnostic` / `radiology`, or `undefined` for
 * ungrouped modules). The group drives the grouped module picker in the branch
 * form (common block + diagnostic/radiology accordions).
 */
export interface CatalogueModule {
  key: string;
  label: string;
  group?: ModuleGroup;
}

/**
 * Read-only access to the branch-type → module catalogue.
 *
 * Every method derives its result from the `BRANCH_MODULES` constant (the sole
 * source of truth) at call time, so config changes are reflected with no code
 * change. Module keys are resolved to display labels via the unified
 * `SYSTEM_MODULES` catalogue.
 */
@Injectable()
export class BranchCatalogueService {
  /**
   * Lists every available branch-type name.
   *
   * @returns the branch-type keys, in catalogue order.
   */
  getBranchTypes(): string[] {
    return Object.keys(BRANCH_MODULES);
  }

  /**
   * Lists all modules across every branch type, de-duplicated and in the
   * canonical `SYSTEM_MODULES` display order.
   *
   * @returns the unique modules as `{ key, label, group }`.
   */
  getAllModules(): CatalogueModule[] {
    const keys = new Set<string>();
    for (const list of Object.values(BRANCH_MODULES)) {
      for (const moduleKey of list) {
        keys.add(moduleKey);
      }
    }
    return [...keys].sort(byCanonicalOrder).map((key) => ({
      key,
      label: moduleLabel(key),
      group: moduleGroup(key),
    }));
  }

  /**
   * Lists the modules belonging to a single branch type.
   *
   * @param branchType the branch-type key (case-sensitive).
   * @returns the branch type's modules as `{ key, label }` (empty if it has none).
   * @throws InvalidBranchTypeException if the branch type is not in the catalogue.
   */
  getModulesForBranchType(branchType: string): CatalogueModule[] {
    if (!Object.prototype.hasOwnProperty.call(BRANCH_MODULES, branchType)) {
      throw new InvalidBranchTypeException(branchType, this.getBranchTypes());
    }
    return [...(BRANCH_MODULES[branchType] ?? [])]
      .sort(byCanonicalOrder)
      .map((key) => ({
        key,
        label: moduleLabel(key),
        group: moduleGroup(key),
      }));
  }
}
