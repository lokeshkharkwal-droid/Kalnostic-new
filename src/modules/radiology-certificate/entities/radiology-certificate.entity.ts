import { RadiologyCertificate } from '@prisma/client';

/** A full radiology-certificate row. */
export type RadiologyCertificateRow = RadiologyCertificate;

/** The trimmed shape returned by the options endpoint. */
export interface RadiologyCertificateOption {
  id: string;
  name: string;
  groupName: string;
}
