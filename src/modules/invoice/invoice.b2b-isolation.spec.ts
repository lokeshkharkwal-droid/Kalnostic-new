import { InvoicePartyType } from '@prisma/client';
import {
  applyB2bInvoiceScope,
  assertInvoicePanelOwnership,
} from './invoice.service';
import { ReferralPanelAccessDeniedException } from '../../common/exceptions/referral-panel-access.exception';

describe('invoice b2b isolation helpers', () => {
  it('forces partyType=B2B + partyId when a panel scope is active', () => {
    const where: Record<string, unknown> = { tenantId: 't1', deletedAt: null };
    applyB2bInvoiceScope(where, 'panel-3');
    expect(where.partyType).toBe(InvoicePartyType.B2B);
    expect(where.partyId).toBe('panel-3');
  });

  it('throws when the invoice bills a different panel', () => {
    expect(() =>
      assertInvoicePanelOwnership(
        { id: 'i1', partyType: InvoicePartyType.B2B, partyId: 'other' },
        'panel-3',
      ),
    ).toThrow(ReferralPanelAccessDeniedException);
  });

  it('throws when the invoice is not a B2B-party invoice at all', () => {
    expect(() =>
      assertInvoicePanelOwnership(
        {
          id: 'i1',
          partyType: InvoicePartyType.REFERRED_BY,
          partyId: 'panel-3',
        },
        'panel-3',
      ),
    ).toThrow(ReferralPanelAccessDeniedException);
  });

  it('passes for the active panel', () => {
    expect(() =>
      assertInvoicePanelOwnership(
        { id: 'i1', partyType: InvoicePartyType.B2B, partyId: 'panel-3' },
        'panel-3',
      ),
    ).not.toThrow();
  });
});
