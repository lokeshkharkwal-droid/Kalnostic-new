import { SupportInfo } from '@prisma/client';

/** Domain/response shape for a support-info record (Prisma model is the source of truth). */
export type SupportInfoEntity = SupportInfo;

/** Projected columns returned by the listing endpoint (CLAUDE.md §list contract). */
export type SupportInfoListItem = Pick<
  SupportInfo,
  'id' | 'metaType' | 'code' | 'title' | 'updatedAt' | 'tenantType' | 'status'
>;
