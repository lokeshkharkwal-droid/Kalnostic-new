import { HttpStatus } from '@nestjs/common';
import { KaltrosException } from '../../../common/exceptions/kaltros.exception';

/** 404 — document not found within the caller's tenant/branch. */
export class DocumentNotFoundException extends KaltrosException {
  constructor(id: string) {
    super(
      'DOCUMENT_NOT_FOUND',
      'Document not found',
      { id },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 404 — version snapshot not found for the document. */
export class DocumentVersionNotFoundException extends KaltrosException {
  constructor(documentId: string, versionId: string) {
    super(
      'DOCUMENT_VERSION_NOT_FOUND',
      'Document version not found',
      { documentId, versionId },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 409 — another active document in this branch already uses this number. */
export class DocumentNumberConflictException extends KaltrosException {
  constructor(documentNumber: string) {
    super(
      'DOCUMENT_NUMBER_CONFLICT',
      'A document with this number already exists in this branch',
      { documentNumber },
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * 409 — the supplied version string is already used by an existing version of
 * this document (every edit must introduce a new, unique version string).
 */
export class DocumentVersionConflictException extends KaltrosException {
  constructor(version: string) {
    super(
      'DOCUMENT_VERSION_CONFLICT',
      'This version already exists for the document; provide a new version',
      { version },
      HttpStatus.CONFLICT,
    );
  }
}

/** 404 — author/approver does not reference an active staff member of the tenant. */
export class InvalidDocumentAuthorException extends KaltrosException {
  constructor(personId: string) {
    super(
      'INVALID_DOCUMENT_AUTHOR',
      'Author/approver must be an active staff member of the tenant',
      { personId },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** 400 — the request has no active branch context (JWT lacks active_branch_id). */
export class BranchContextRequiredException extends KaltrosException {
  constructor() {
    super(
      'BRANCH_CONTEXT_REQUIRED',
      'An active branch context is required for this operation',
      {},
      HttpStatus.BAD_REQUEST,
    );
  }
}
