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

/**
 * 500 — the bundled India location master JSON could not be located on the
 * server. The searched paths are logged (context) but never returned to the
 * client, so no filesystem layout leaks out.
 */
export class IndiaLocationDataFileNotFoundException extends KaltrosException {
  constructor(searchedPaths: string[], detail?: string) {
    super(
      'INDIA_LOCATION_DATA_FILE_NOT_FOUND',
      'India location data is not available on the server.',
      { searchedPaths, detail },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}

/**
 * 500 — the India location master JSON is present but could not be parsed or
 * failed structural validation (bad JSON / unexpected shape).
 */
export class IndiaLocationDataMalformedException extends KaltrosException {
  constructor(detail: string) {
    super(
      'INDIA_LOCATION_DATA_MALFORMED',
      'India location data is malformed and could not be processed.',
      { detail },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}

/**
 * 500 — a database error interrupted the India location sync. The transaction
 * rolls back, so the sync stays all-or-nothing; the client is asked to retry.
 */
export class IndiaLocationSyncFailedException extends KaltrosException {
  constructor(detail: string) {
    super(
      'INDIA_LOCATION_SYNC_FAILED',
      'The India location sync could not be completed. Please try again.',
      { detail },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
