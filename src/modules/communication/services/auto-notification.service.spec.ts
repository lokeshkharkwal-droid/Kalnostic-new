import { MessagingChannel, RecipientType } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CommunicationService } from '../communication.service';
import { NotificationService } from '../notification.service';
import { TemplateService } from '../../template/template.service';
import { AutoNotificationService } from './auto-notification.service';
import { NotificationEnablementService } from './notification-enablement.service';
import { NotificationTagsService } from './notification-tags.service';

describe('AutoNotificationService — global tags', () => {
  const globals = {
    patient_name: 'Asha Rao',
    web_title: 'Kalnostic Labs',
    order_number: 'ORD-1',
    amount: '',
  };
  const resolve = jest.fn().mockResolvedValue(globals);
  const enqueue = jest.fn().mockResolvedValue([]);
  const notify = jest.fn().mockResolvedValue({ id: 'n-1' });
  const resolveForDelivery = jest.fn();
  let service: AutoNotificationService;

  beforeEach(() => {
    jest.clearAllMocks();
    resolveForDelivery.mockImplementation(
      (_t: string, _b: string | null, channel: MessagingChannel) =>
        Promise.resolve(
          channel === MessagingChannel.IAM
            ? { template: 'IAM {order_number} {amount} {web_title}' }
            : { template: 'x' },
        ),
    );
    service = new AutoNotificationService(
      {
        withTenant: jest.fn().mockResolvedValue({
          id: 'p-1',
          firstName: 'Asha',
          lastName: 'Rao',
          email: 'asha@example.com',
          mobile: '9999999999',
          whatsappNumber: null,
        }),
      } as unknown as PrismaService,
      { enqueue } as unknown as CommunicationService,
      { create: notify } as unknown as NotificationService,
      { resolveForDelivery } as unknown as TemplateService,
      {
        resolveEnabledChannels: jest
          .fn()
          .mockResolvedValue([MessagingChannel.EMAIL, MessagingChannel.SMS]),
      } as unknown as NotificationEnablementService,
      { resolve } as unknown as NotificationTagsService,
    );
  });

  it('resolves once from the spec context and shares it with IAM + every channel', async () => {
    const at = new Date('2026-11-20T04:30:00Z');
    await service.dispatchToPatient('t-1', 'b-1', 'p-1', {
      feature: 'complete_payment_for_lab_order_inform_patient',
      verb: 'payment_received',
      subject: 'Payment',
      context: { orderId: 'o-1', at },
      variables: { amount: '450.00' },
      fallbackHtml: () => '<p>x</p>',
    });

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith({
      tenantId: 't-1',
      branchId: 'b-1',
      orderId: 'o-1',
      at,
      patientId: 'p-1',
      recipientName: 'Asha Rao',
      recipientEmail: 'asha@example.com',
    });

    // IAM body: globals + the event's override.
    const iamCall = notify.mock.calls[0] as [
      unknown,
      unknown,
      { body: string },
    ];
    expect(iamCall[2].body).toBe('IAM ORD-1 450.00 Kalnostic Labs');

    // Each channel gets the same merged map, flagged as already resolved, plus
    // the spec context so the row is linked to its order (Past Notifications).
    expect(enqueue).toHaveBeenCalledTimes(2);
    type EnqueueCall = [
      string,
      string | null,
      { variables: Record<string, string> },
      string,
      { resolved: Record<string, string>; context?: unknown },
    ];
    for (const call of enqueue.mock.calls as EnqueueCall[]) {
      const [, , dto, actor, tagOpts] = call;
      expect(actor).toBe('system');
      expect(dto.variables).toMatchObject({
        web_title: 'Kalnostic Labs',
        order_number: 'ORD-1',
        amount: '450.00',
      });
      expect(tagOpts).toEqual({
        resolved: dto.variables,
        context: { orderId: 'o-1', at },
      });
    }
  });

  it('a non-patient contact passes its own email and the order patient comes from context', async () => {
    await service.dispatchToContact(
      't-1',
      null,
      {
        recipientType: RecipientType.CUSTOM,
        name: 'City Panel',
        email: null,
        mobile: '9000000000',
      },
      {
        feature: 'lab_report_sample_error_inform_referring_panel',
        verb: 'sample_error',
        subject: 'Sample error',
        context: { orderId: 'o-1' },
        fallbackHtml: () => '<p>x</p>',
      },
    );
    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'o-1',
        patientId: null,
        recipientName: 'City Panel',
        recipientEmail: null,
      }),
    );
  });
});
