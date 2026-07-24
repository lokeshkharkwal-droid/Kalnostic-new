import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — sales territory not found within the tenant/branch. */
export class SalesTerritoryNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'SALES_TERRITORY_NOT_FOUND',
      'Sales territory not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 409 — another active sales territory already uses this name at the branch. */
export class SalesTerritoryNameConflictException extends KaltrosException {
  constructor(name: string) {
    super(
      'SALES_TERRITORY_NAME_CONFLICT',
      'A sales territory with this name already exists at this branch',
      { name },
      HttpStatus.CONFLICT,
    );
  }
}

/** 400 — one or more territory ids don't belong to the caller's tenant/branch. */
export class InvalidSalesTerritoriesException extends KaltrosException {
  constructor(territoryIds: string[]) {
    super(
      'INVALID_SALES_TERRITORIES',
      'One or more sales territories are invalid for this branch',
      { territoryIds },
      HttpStatus.BAD_REQUEST,
    );
  }
}

/**
 * 400 — the caller's JWT has no active branch, but the operation is branch-level.
 */
export class ActiveBranchRequiredException extends KaltrosException {
  constructor() {
    super(
      'ACTIVE_BRANCH_REQUIRED',
      'An active branch is required for this operation. Switch to a branch profile.',
      {},
      HttpStatus.BAD_REQUEST,
    );
  }
}
