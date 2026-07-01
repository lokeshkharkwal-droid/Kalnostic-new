import { Prisma, Document, DocumentVersion } from '@prisma/client';

/** Eager-load the catalogue relations on a document. */
export const DOCUMENT_INCLUDE = {
  category: true,
  department: true,
} satisfies Prisma.DocumentInclude;

/** Domain/response shape for a document (Prisma model is the source of truth). */
export type DocumentEntity = Document;

/** A document with its category + department relations loaded. */
export type DocumentWithRelations = Prisma.DocumentGetPayload<{
  include: typeof DOCUMENT_INCLUDE;
}>;

/** An immutable version snapshot. */
export type DocumentVersionEntity = DocumentVersion;
