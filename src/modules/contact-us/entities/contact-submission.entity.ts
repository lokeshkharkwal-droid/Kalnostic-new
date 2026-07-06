import { ContactSubmission } from '@prisma/client';

/** Domain/response shape for a contact submission (Prisma model is the source of truth). */
export type ContactSubmissionEntity = ContactSubmission;

/**
 * A single row of the `GET /siteadmin/contact-us` listing. `companyName` is
 * surfaced as `organization` and `createdAt` as `createdOn` to match the agreed
 * frontend contract.
 */
export interface ContactSubmissionListItem {
  id: string;
  name: string;
  organization: string;
  mobileNumber: string;
  email: string;
  message: string;
  createdOn: Date;
}
