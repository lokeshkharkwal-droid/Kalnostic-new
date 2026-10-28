import { MessagingChannel } from '@prisma/client';
import { LabReportService } from './lab-report.service';
import {
  ShareOrderReportDto,
  ShareAllOrderReportDto,
} from './dto/share-order-report.dto';
import { ReferralReportCreditLimitException } from '../referral-credit/referral-credit.exceptions';

/**
 * GAP 2 regression: sharing a report releases its PDF to the patient/B2B, so the
 * Referral Panel Settings credit gate must block share (single + all channels)
 * exactly like print/print-all. The gate runs BEFORE any PDF is rendered or any
 * channel is dispatched, so an over-limit account cannot leak a report via Share.
 */
describe('LabReportService — share blocked by the referral credit gate', () => {
  const build = () => {
    const assertReportAccessAllowedByOrderId = jest
      .fn()
      .mockRejectedValue(
        new ReferralReportCreditLimitException('Postpaid 30d', 5000, 1000),
      );
    const makeSharePdfProvider = jest.fn(() => {
      throw new Error('REACHED_PDF_PROVIDER');
    });
    const dispatchDeliverableShare = jest.fn();
    const dispatchIamShare = jest.fn();

    const svc = Object.create(LabReportService.prototype) as LabReportService;
    Object.assign(svc, {
      referralCredit: { assertReportAccessAllowedByOrderId },
    });
    Object.assign(svc as unknown as Record<string, unknown>, {
      loadOrderForShare: jest.fn().mockResolvedValue({ order: { id: 'o1' } }),
      makeSharePdfProvider,
      dispatchDeliverableShare,
      dispatchIamShare,
    });
    return {
      svc,
      assertReportAccessAllowedByOrderId,
      makeSharePdfProvider,
      dispatchDeliverableShare,
      dispatchIamShare,
    };
  };

  it('single-channel share is refused, before rendering a PDF or dispatching', async () => {
    const { svc, assertReportAccessAllowedByOrderId, makeSharePdfProvider } =
      build();
    const dto: ShareOrderReportDto = {
      channel: MessagingChannel.EMAIL,
      toAddress: 'patient@example.com',
    };
    await expect(
      svc.shareOrderReport('o1', 't1', 'b1', dto, 'actor-1'),
    ).rejects.toBeInstanceOf(ReferralReportCreditLimitException);
    expect(assertReportAccessAllowedByOrderId).toHaveBeenCalledWith('t1', 'o1');
    expect(makeSharePdfProvider).not.toHaveBeenCalled();
  });

  it('share-all is refused, before rendering a PDF or dispatching', async () => {
    const { svc, makeSharePdfProvider, dispatchDeliverableShare } = build();
    const dto: ShareAllOrderReportDto = {};
    await expect(
      svc.shareAllForOrder('o1', 't1', 'b1', dto, 'actor-1'),
    ).rejects.toBeInstanceOf(ReferralReportCreditLimitException);
    expect(makeSharePdfProvider).not.toHaveBeenCalled();
    expect(dispatchDeliverableShare).not.toHaveBeenCalled();
  });

  it('carries the 403 code the screen can surface', async () => {
    const { svc } = build();
    await expect(
      svc.shareAllForOrder('o1', 't1', 'b1', {}, 'actor-1'),
    ).rejects.toMatchObject({
      response: { error: { code: 'REFERRAL_REPORT_CREDIT_LIMIT_BLOCKED' } },
    });
  });
});
