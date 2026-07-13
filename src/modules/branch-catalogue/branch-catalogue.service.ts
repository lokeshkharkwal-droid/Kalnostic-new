import { Injectable } from '@nestjs/common';
import { moduleLabel } from '../permissions/constants/system-modules.constant';
import { BRANCH_MODULES } from './constants/branch-modules.constant';
import { InvalidBranchTypeException } from './exceptions/branch-catalogue.exceptions';

/** A module offered by a branch type: its stable key and display label. */
export interface CatalogueModule {
  key: string;
  label: string;
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
   * Lists all modules across every branch type, de-duplicated and kept in
   * first-appearance order.
   *
   * @returns the unique modules as `{ key, label }`.
   */
  getAllModules(): CatalogueModule[] {
    const keys = new Set<string>();
    for (const list of Object.values(BRANCH_MODULES)) {
      for (const moduleKey of list) {
        keys.add(moduleKey);
      }
    }
    return [...keys].map((key) => ({ key, label: moduleLabel(key) }));
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
    return [...(BRANCH_MODULES[branchType] ?? [])].map((key) => ({
      key,
      label: moduleLabel(key),
    }));
  }
}
