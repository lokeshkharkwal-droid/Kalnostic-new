import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — country not found (or soft-deleted). */
export class CountryNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'COUNTRY_NOT_FOUND',
      'Country not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 404 — state not found (or soft-deleted). */
export class StateNotFoundException extends KaltrosException {
  constructor(id: string) {
    super('STATE_NOT_FOUND', 'State not found', { id }, HttpStatus.NOT_FOUND);
  }
}

/** 404 — city not found (or soft-deleted). */
export class CityNotFoundException extends KaltrosException {
  constructor(id: string) {
    super('CITY_NOT_FOUND', 'City not found', { id }, HttpStatus.NOT_FOUND);
  }
}

/** 404 — area not found (or soft-deleted). */
export class AreaNotFoundException extends KaltrosException {
  constructor(id: string) {
    super('AREA_NOT_FOUND', 'Area not found', { id }, HttpStatus.NOT_FOUND);
  }
}

/**
 * 400 — the denormalized ancestor foreign keys are inconsistent with the
 * resolved parent (e.g. a City's `countryId` does not match its `state.countryId`,
 * or an Area's `stateId`/`countryId` do not match its `city`). Prevents building
 * an invalid Country → State → City → Area chain.
 */
export class LocationHierarchyMismatchException extends KaltrosException {
  constructor(detail: string, context: Record<string, unknown> = {}) {
    super(
      'LOCATION_HIERARCHY_MISMATCH',
      `Location hierarchy is inconsistent: ${detail}`,
      context,
      HttpStatus.BAD_REQUEST,
    );
  }
}

/**
 * 409 — a location cannot be soft-deleted because it still has active children
 * (e.g. a Country with active States). Delete the children first.
 */
export class LocationHasChildrenException extends KaltrosException {
  constructor(entity: string, childCount: number) {
    super(
      'LOCATION_HAS_CHILDREN',
      `Cannot delete this ${entity} while it still has active child records`,
      { entity, childCount },
      HttpStatus.CONFLICT,
    );
  }
}
