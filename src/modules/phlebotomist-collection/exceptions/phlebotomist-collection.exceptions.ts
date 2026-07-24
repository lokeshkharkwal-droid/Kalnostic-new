import { HttpStatus } from '@nestjs/common';
import { CollectionStatus } from '@prisma/client';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — the home-visit collection does not resolve in the caller's tenant. */
export class CollectionNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'COLLECTION_NOT_FOUND',
      'Home visit collection not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 422 — the requested status transition is not allowed from the current status. */
export class IllegalCollectionTransitionException extends KaltrosException {
  constructor(from: CollectionStatus, to: CollectionStatus) {
    super(
      'ILLEGAL_COLLECTION_TRANSITION',
      `Cannot move a collection from ${from} to ${to}`,
      { from, to },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** 422 — the collection cannot be rescheduled from its current (terminal) status. */
export class CollectionNotReschedulableException extends KaltrosException {
  constructor(from: CollectionStatus) {
    super(
      'COLLECTION_NOT_RESCHEDULABLE',
      `A ${from} collection cannot be rescheduled`,
      { from },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
