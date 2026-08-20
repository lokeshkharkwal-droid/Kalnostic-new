/**
 * Known owner types for a generic {@link Attachment}. `entityType` is stored as a
 * plain string (no Prisma enum) so a new owner needs no migration — but writes
 * are still constrained to this allow-list via the DTO's `@IsIn`. Add a slug here
 * when a new feature starts attaching files.
 */
export const ATTACHMENT_ENTITY_TYPES = [
  'INCIDENT_REPORT',
  'TECHNICIAN_PROCESS',
  'QUALITY_CONTROL',
  'INVENTORY',
  'ACCESSION',
  'TEMPLATE',
  'ORDER',
  'PATIENT',
  'LAB_REPORT',
  'PHLEBOTOMY',
  'MISC',
] as const;

export type AttachmentEntityType = (typeof ATTACHMENT_ENTITY_TYPES)[number];
