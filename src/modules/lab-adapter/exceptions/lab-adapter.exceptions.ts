import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — lab adapter not found (missing, soft-deleted, or other tenant). */
export class LabAdapterNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'LAB_ADAPTER_NOT_FOUND',
      'Lab adapter not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 409 — another active lab adapter in this tenant already uses this name. */
export class LabAdapterNameConflictException extends KaltrosException {
  constructor(name: string) {
    super(
      'LAB_ADAPTER_NAME_CONFLICT',
      'A lab adapter with this name already exists',
      { name },
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * 422 — the selected `equipmentId` does not reference an active global (SITE_ADMIN)
 * equipment.
 */
export class LabAdapterEquipmentNotFoundException extends KaltrosException {
  constructor(equipmentId: string) {
    super(
      'LAB_ADAPTER_EQUIPMENT_NOT_FOUND',
      'The selected equipment does not reference an active equipment',
      { equipmentId },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/**
 * 422 — one or more selected `branchIds` do not reference an active branch of the
 * caller's tenant.
 */
export class LabAdapterBranchNotFoundException extends KaltrosException {
  constructor(branchIds: string[]) {
    super(
      'LAB_ADAPTER_BRANCH_NOT_FOUND',
      'One or more selected branches do not reference an active branch',
      { branchIds },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/**
 * 422 — one or more selected `labTestIds` do not reference an active branch lab
 * test of the caller's tenant/active branch.
 */
export class LabAdapterLabTestNotFoundException extends KaltrosException {
  constructor(labTestIds: string[]) {
    super(
      'LAB_ADAPTER_LAB_TEST_NOT_FOUND',
      'One or more selected lab tests do not reference an active branch lab test',
      { labTestIds },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
