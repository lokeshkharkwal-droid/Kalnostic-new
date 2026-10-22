import { Prisma } from '@prisma/client';

/** An issued radiology certificate row (the DB model is the source of truth). */
export type RadiologyCertificateIssuedEntity =
  Prisma.RadiologyCertificateIssuedGetPayload<object>;

/**
 * A freshly-rendered (not-yet-saved) certificate preview: the template's labels
 * plus its `{placeholder}`-resolved HTML, ready for the doctor to edit/issue.
 */
export interface RadiologyCertificatePreview {
  certificateId: string;
  certificateName: string;
  groupName: string | null;
  content: string;
}
