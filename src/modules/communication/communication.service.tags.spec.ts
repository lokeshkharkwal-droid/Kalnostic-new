import { ConfigService } from '@nestjs/config';
import { MessagingChannel, RecipientType } from '@prisma/client';
import { CommunicationService } from './communication.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ExchangeClient } from './exchange/exchange.client';
import { TemplateService } from '../template/template.service';
import { BranchService } from '../branch/branch.service';
import { TenantTimeZoneService } from '../tenant/tenant-timezone.service';
import { NotificationTagsService } from './services/notification-tags.service';
import { NOTIFICATION_TAG_KEYS } from '../template/constants/notification-tags';
import { SendMessageDto } from './dto/send-message.dto';

/**
 * `enqueue` is the choke point every Email/SMS/WhatsApp send goes through
 * (automatic notifications, Share and Inform, manual compose). These tests run
 * the REAL `NotificationTagsService` over a mocked DB to prove the global tag
 * catalogue is substituted for any template, with the documented precedence.
 */
describe('CommunicationService.enqueue — global notification tags', () => {
  const ALL_TAGS_BODY =
    NOTIFICATION_TAG_KEYS.map((k) => `${k}=[{${k}}]`).join(' | ') +
    ' | unknown=[{not_a_tag}] | css=[a{color:red}]';

  const order = {
    orderCode: 'ORD-00012',
    billId: 'BILL-77',
    branchId: 'b-1',
    patientId: 'p-1',
    branch: {
      name: 'Andheri Branch',
      shortName: 'AND',
      phone: '0224000',
      addressLine: null,
      city: null,
    },
    items: [{ direct: 'CBC', branchLabTest: null, branchLabPanel: null }],
    payments: [{ totalAmount: 500, netAmount: 450, paidAmount: 450 }],
    diagnostics: null,
    opd: null,
    referredByDoctor: null,
  };
  const patient = {
    id: 'p-1',
    firstName: 'Asha',
    middleName: null,
    lastName: 'Rao',
    umId: 'PAT-1',
    email: 'asha@example.com',
    mobile: '9999999999',
    familyMemberOf: [],
  };

  let created: Array<{ body: string; payload: unknown }>;
  let tags: NotificationTagsService;
  let service: CommunicationService;
  let resolveForDelivery: jest.Mock;

  beforeEach(() => {
    created = [];
    const tx = {
      order: { findFirst: jest.fn().mockResolvedValue(order) },
      branch: { findFirst: jest.fn().mockResolvedValue(order.branch) },
      patient: {
        findFirst: jest.fn().mockResolvedValue(patient),
        findMany: jest.fn().mockResolvedValue([patient]),
      },
      communicationLog: {
        create: jest.fn(
          ({ data }: { data: { body: string; payload: unknown } }) => {
            created.push(data);
            return Promise.resolve(data);
          },
        ),
      },
    };
    const prisma = {
      tenant: {
        findFirst: jest.fn().mockResolvedValue({
          name: 'Kalnostic Labs',
          shortName: 'KAL',
          settings: {},
        }),
      },
      person: { findMany: jest.fn().mockResolvedValue([]) },
      withTenant: jest.fn((_t: string, cb: (c: typeof tx) => unknown) =>
        cb(tx),
      ),
    } as unknown as PrismaService;
    tags = new NotificationTagsService(
      prisma,
      { get: () => 'https://app.test' } as unknown as ConfigService,
      {
        getTimeZone: jest.fn().mockResolvedValue('Asia/Kolkata'),
      } as unknown as TenantTimeZoneService,
    );
    resolveForDelivery = jest.fn().mockResolvedValue({
      id: 'tpl-1',
      template: ALL_TAGS_BODY,
      displayTitle: 'All tags',
      smsTemplateId: 'wa-1',
      smsSenderId: null,
      smsType: null,
      templateCategory: null,
    });
    service = new CommunicationService(
      prisma,
      {} as unknown as ExchangeClient,
      { resolveForDelivery } as unknown as TemplateService,
      { findById: jest.fn() } as unknown as BranchService,
      tags,
    );
  });

  const dto = (over: Partial<SendMessageDto> = {}): SendMessageDto => ({
    channel: MessagingChannel.SMS,
    feature: 'lab_create_order_inform_patient',
    recipients: [
      {
        recipientType: RecipientType.PATIENT,
        recipientId: 'p-1',
        recipientName: 'Asha Rao',
        toAddress: '9999999999',
      },
    ],
    ...over,
  });

  it('substitutes EVERY catalogue tag in any template (order context)', async () => {
    await service.enqueue('t-1', null, dto(), 'u-1', {
      context: { orderId: 'o-1' },
    });
    const body = created[0]!.body;
    for (const k of NOTIFICATION_TAG_KEYS) {
      expect(body).not.toContain(`{${k}}`);
    }
    expect(body).toContain('order_number=[ORD-00012]');
    expect(body).toContain('user_name=[Andheri Branch]');
    expect(body).toContain('web_title=[Kalnostic Labs]');
    expect(body).toContain('balance_amount=[0.00]');
    expect(body).toContain('patient_unique_id=[PAT-1]');
    expect(body).toContain(
      'short_link=[https://app.test/public/patient-report/t-1/b-1/o-1]',
    );
    // Non-catalogue braces are left exactly as written.
    expect(body).toContain('unknown=[{not_a_tag}]');
    expect(body).toContain('css=[a{color:red}]');
  });

  it('caller variables override globals; recipient name still wins for patient_name', async () => {
    await service.enqueue(
      't-1',
      null,
      dto({
        variables: { amount: '450.00', web_title: 'Custom', patient_name: 'X' },
      }),
      'u-1',
      { context: { orderId: 'o-1' } },
    );
    const body = created[0]!.body;
    expect(body).toContain('amount=[450.00]');
    expect(body).toContain('web_title=[Custom]');
    expect(body).toContain('patient_name=[Asha Rao]');
  });

  it('{pn} was removed as a duplicate of {patient_name}: left as literal text', async () => {
    await service.enqueue(
      't-1',
      null,
      dto({ body: 'Dear {pn} / {patient_name}' }),
      'u-1',
      { context: { orderId: 'o-1' } },
    );
    expect(created[0]!.body).toBe('Dear {pn} / Asha Rao');
  });

  it("manual compose (no context): tenant/branch tags + the PATIENT recipient's own tags", async () => {
    await service.enqueue('t-1', 'b-1', dto(), 'u-1');
    const body = created[0]!.body;
    expect(body).toContain('user_name=[Andheri Branch]');
    expect(body).toContain('pfn=[Asha Rao]');
    expect(body).toContain('patient_unique_id=[PAT-1]');
    expect(body).toContain('email=[asha@example.com]');
    expect(body).toContain('order_number=[]'); // no order → blank, not literal
  });

  it('uses caller-resolved tags as-is (no second DB resolution)', async () => {
    const spy = jest.spyOn(tags, 'resolve');
    await service.enqueue(
      't-1',
      null,
      dto({ variables: { order_number: 'ORD-9' } }),
      'system',
      { resolved: { web_title: 'Pre-resolved', order_number: 'ORD-9' } },
    );
    expect(spy).not.toHaveBeenCalled();
    expect(created[0]!.body).toContain('web_title=[Pre-resolved]');
  });

  it('{email} falls back to the address on an Email send', async () => {
    await service.enqueue(
      't-1',
      null,
      dto({
        channel: MessagingChannel.EMAIL,
        recipients: [
          {
            recipientType: RecipientType.CUSTOM,
            recipientName: 'Panel',
            toAddress: 'panel@example.com',
          },
        ],
      }),
      'u-1',
      { context: { orderId: 'o-1', recipientEmail: null } },
    );
    expect(created[0]!.body).toContain('email=[panel@example.com]');
  });

  it('fills tags in the Email subject as well', async () => {
    await service.enqueue(
      't-1',
      null,
      dto({
        channel: MessagingChannel.EMAIL,
        subject: 'Report {order_number} from {user_name}',
      }),
      'u-1',
      { context: { orderId: 'o-1' } },
    );
    expect((created[0] as unknown as { subject: string }).subject).toBe(
      'Report ORD-00012 from Andheri Branch',
    );
  });

  it('WhatsApp positional params carry the resolved values', async () => {
    await service.enqueue(
      't-1',
      null,
      dto({ channel: MessagingChannel.WHATSAPP }),
      'u-1',
      { context: { orderId: 'o-1' } },
    );
    const params = (created[0]!.payload as { templateParams: string[] })
      .templateParams;
    const idx = NOTIFICATION_TAG_KEYS.indexOf('order_number');
    expect(params[idx]).toBe('ORD-00012');
    expect(params).toHaveLength(NOTIFICATION_TAG_KEYS.length + 1); // + {not_a_tag}
  });
});
