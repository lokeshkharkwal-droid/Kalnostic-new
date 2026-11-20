import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import { TenantTimeZoneService } from '../../tenant/tenant-timezone.service';
import { NOTIFICATION_TAG_KEYS } from '../../template/constants/notification-tags';
import { NotificationTagsService } from './notification-tags.service';

const TENANT = 't-1';
const BRANCH = 'b-1';
const ORDER = 'o-1';
const PATIENT = 'p-1';

const tenantRow = {
  name: 'Kalnostic Labs',
  shortName: 'KAL',
  settings: { currency: 'INR', date_format: 'DD/MM/YYYY', time_format: '12h' },
};

const branchRow = {
  name: 'Andheri Branch',
  shortName: 'AND',
  phone: '02240001234',
  addressLine: '12 Link Road',
  city: 'Mumbai',
};

const patientRow = {
  id: PATIENT,
  firstName: 'Asha',
  middleName: 'K',
  lastName: 'Rao',
  umId: 'PAT-00042',
  email: 'asha@example.com',
  mobile: '9876500000',
  familyMemberOf: [] as Array<{
    relationship: string;
    patient: { mobile: string | null };
  }>,
};

/** A home-visit order with a phlebotomist, an OPD consultant and a referrer. */
const fullOrder = {
  orderCode: 'ORD-00012',
  billId: 'BILL-77',
  branchId: BRANCH,
  patientId: PATIENT,
  branch: branchRow,
  items: [
    { direct: null, branchLabTest: { testName: 'CBC' }, branchLabPanel: null },
    {
      direct: null,
      branchLabTest: null,
      branchLabPanel: { panelName: 'Lipid Profile' },
    },
    { direct: 'Urine R/M', branchLabTest: null, branchLabPanel: null },
  ],
  payments: [{ totalAmount: 1200, netAmount: 1000, paidAmount: 400 }],
  diagnostics: {
    isHomeVisit: true,
    collectionAddress: 'Flat 4, Sea View, Bandra',
    phlebotomist: { firstName: 'Ravi', lastName: 'Kumar', phone: '9876500000' },
  },
  opd: { doctor: { firstName: 'Meera', lastName: 'Kapoor' } },
  referredByDoctor: {
    firstName: 'Arun',
    middleName: null,
    lastName: 'Singh',
    hospitalName: 'City Care Clinic',
  },
  appointment: { code: 'APT-00045' },
  referralPanel: { name: 'Sunrise Hospital' },
};

function build(opts: {
  order?: unknown;
  branch?: unknown;
  patient?: unknown;
  frontendUrl?: string | undefined;
  zone?: string;
  tenant?: unknown;
  persons?: unknown[];
  failOrder?: boolean;
}) {
  const tx = {
    order: {
      findFirst: jest.fn().mockImplementation(() => {
        if (opts.failOrder) return Promise.reject(new Error('db down'));
        return Promise.resolve(opts.order ?? null);
      }),
    },
    branch: { findFirst: jest.fn().mockResolvedValue(opts.branch ?? null) },
    patient: {
      findFirst: jest.fn().mockResolvedValue(opts.patient ?? null),
      findMany: jest.fn().mockResolvedValue(opts.patient ? [opts.patient] : []),
    },
  };
  const prisma = {
    tenant: {
      findFirst: jest
        .fn()
        .mockResolvedValue(opts.tenant === undefined ? tenantRow : opts.tenant),
    },
    person: { findMany: jest.fn().mockResolvedValue(opts.persons ?? []) },
    withTenant: jest.fn((_t: string, cb: (c: typeof tx) => unknown) => cb(tx)),
  };
  const config = {
    get: jest.fn((key: string) =>
      key === 'exchange.frontendUrl' ? opts.frontendUrl : undefined,
    ),
  };
  const tz = {
    getTimeZone: jest.fn().mockResolvedValue(opts.zone ?? 'Asia/Kolkata'),
  };
  const service = new NotificationTagsService(
    prisma as unknown as PrismaService,
    config as unknown as ConfigService,
    tz as unknown as TenantTimeZoneService,
  );
  return { service, prisma, tx };
}

describe('NotificationTagsService.resolve', () => {
  it('always returns every catalogue key (no tag can leak as literal text)', async () => {
    const { service } = build({});
    const out = await service.resolve({ tenantId: TENANT });
    expect(Object.keys(out).sort()).toEqual([...NOTIFICATION_TAG_KEYS].sort());
    for (const v of Object.values(out)) expect(typeof v).toBe('string');
  });

  it('has no duplicate keys and no {pn} (removed: same value as {patient_name})', () => {
    expect(new Set(NOTIFICATION_TAG_KEYS).size).toBe(
      NOTIFICATION_TAG_KEYS.length,
    );
    expect(NOTIFICATION_TAG_KEYS).not.toContain('pn');
    expect(NOTIFICATION_TAG_KEYS).toHaveLength(35);
  });

  it('resolves all tags for a home-visit order with phlebotomist, OPD doctor and referrer', async () => {
    const { service } = build({
      order: fullOrder,
      patient: patientRow,
      frontendUrl: 'https://app.kalnostics.com/',
      persons: [
        { id: 'u-9', firstName: 'Neha', middleName: null, lastName: 'Shah' },
      ],
    });
    const out = await service.resolve({
      tenantId: TENANT,
      branchId: 'other-branch',
      orderId: ORDER,
      actorId: 'u-9',
      // 2026-11-20 04:30 UTC = 10:00 AM IST.
      at: new Date('2026-11-20T04:30:00.000Z'),
      recipientName: 'Asha Rao',
    });

    expect(out).toEqual({
      // Recipient & patient
      patient_name: 'Asha Rao',
      pfn: 'Asha K Rao',
      patient: 'Asha K Rao',
      patient_unique_id: 'PAT-00042',
      condition_name: 'you',
      email: 'asha@example.com',
      // Business & branch (order branch wins over the scope branch)
      web_title: 'Kalnostic Labs',
      business_short_name: 'KAL',
      user_name: 'Andheri Branch',
      lab: 'Andheri Branch',
      branch_short_name: 'AND',
      branch_phone_number: '02240001234',
      // Order & payment
      order_number: 'ORD-00012',
      order_code: 'ORD-00012',
      bill_id: 'BILL-77',
      test_list: 'CBC, Lipid Profile, Urine R/M',
      currency: 'INR',
      gross_amount: '1200.00',
      net_amount: '1000.00',
      balance_amount: '600.00',
      amount: '',
      // Appointment & collection
      date: '20/11/2026',
      time: '10:00 AM',
      appointment_code: 'APT-00045',
      location: 'Flat 4, Sea View, Bandra',
      doctor_name: 'Meera Kapoor',
      doctor_business_name: 'City Care Clinic',
      referring_panel_name: 'Sunrise Hospital',
      phlebotomist_name: 'Ravi Kumar',
      phlebo_detail: 'Ravi Kumar (9876500000)',
      // Staff
      updated_by: 'Neha Shah',
      // Links
      weburl: 'https://app.kalnostics.com/',
      short_link: `https://app.kalnostics.com/public/patient-report/${TENANT}/${BRANCH}/${ORDER}`,
      publish_report_url: `https://app.kalnostics.com/public/patient-report/${TENANT}/${BRANCH}/${ORDER}`,
      password: '',
    });
  });

  it('uses the referring doctor + branch address for an in-lab order without OPD', async () => {
    const { service } = build({
      order: {
        ...fullOrder,
        diagnostics: {
          isHomeVisit: false,
          collectionAddress: null,
          phlebotomist: null,
        },
        opd: null,
        appointment: null,
        referralPanel: null,
      },
      patient: patientRow,
    });
    const out = await service.resolve({ tenantId: TENANT, orderId: ORDER });
    expect(out.appointment_code).toBe(''); // walk-in: no appointment
    expect(out.referring_panel_name).toBe(''); // walk-in: no B2B panel
    expect(out.doctor_name).toBe('Arun Singh');
    expect(out.doctor_business_name).toBe('City Care Clinic');
    expect(out.location).toBe('Andheri Branch, 12 Link Road, Mumbai');
    expect(out.phlebotomist_name).toBe('');
    expect(out.phlebo_detail).toBe('');
  });

  it('resolves the tenant-level tags for a business message (no order / branch / patient)', async () => {
    const { service, tx } = build({
      frontendUrl: 'https://app.kalnostics.com',
    });
    const out = await service.resolve({
      tenantId: TENANT,
      recipientName: 'Kalnostic Labs',
      recipientEmail: 'owner@kal.com',
    });
    expect(tx.order.findFirst).not.toHaveBeenCalled();
    expect(out.web_title).toBe('Kalnostic Labs');
    expect(out.user_name).toBe('Kalnostic Labs'); // no branch → business name
    expect(out.lab).toBe('Kalnostic Labs');
    expect(out.business_short_name).toBe('KAL');
    expect(out.branch_short_name).toBe('KAL');
    expect(out.patient_name).toBe('Kalnostic Labs');
    expect(out.pfn).toBe('Kalnostic Labs'); // no patient → recipient
    expect(out.email).toBe('owner@kal.com');
    expect(out.weburl).toBe('https://app.kalnostics.com');
    expect(out.short_link).toBe('https://app.kalnostics.com'); // no order → portal
    for (const k of [
      'order_number',
      'bill_id',
      'test_list',
      'net_amount',
      'doctor_name',
      'patient_unique_id',
      'condition_name',
      'updated_by',
      'location',
      'appointment_code',
      'referring_panel_name',
    ]) {
      expect(out[k]).toBe('');
    }
  });

  it('falls back to the business short name, and the business name when no short name', async () => {
    const { service } = build({
      tenant: { ...tenantRow, shortName: null },
      branch: { ...branchRow, shortName: '' },
    });
    const out = await service.resolve({ tenantId: TENANT, branchId: BRANCH });
    expect(out.business_short_name).toBe('Kalnostic Labs');
    expect(out.branch_short_name).toBe('');
    expect(out.user_name).toBe('Andheri Branch');
    expect(out.location).toBe('Andheri Branch, 12 Link Road, Mumbai');
  });

  it('renders {date}/{time} for `at` in the tenant zone + configured formats', async () => {
    const { service } = build({
      tenant: {
        ...tenantRow,
        settings: { date_format: 'YYYY-MM-DD', time_format: '24h' },
      },
      zone: 'Asia/Dubai',
    });
    const out = await service.resolve({
      tenantId: TENANT,
      at: '2026-11-20T20:15:00.000Z', // 00:15 next day in Dubai (UTC+4)
    });
    expect(out.date).toBe('2026-11-21');
    expect(out.time).toBe('00:15');
    expect(out.currency).toBe('INR'); // default when unset
  });

  it('leaves links blank without FRONTEND_URL and keeps {password} blank', async () => {
    const { service } = build({ order: fullOrder, patient: patientRow });
    const out = await service.resolve({ tenantId: TENANT, orderId: ORDER });
    expect(out.weburl).toBe('');
    expect(out.short_link).toBe('');
    expect(out.publish_report_url).toBe('');
    expect(out.password).toBe('');
  });

  it('{email}: patient email only when the recipient is not someone else', async () => {
    const { service } = build({ order: fullOrder, patient: patientRow });
    const asPatient = await service.resolve({
      tenantId: TENANT,
      orderId: ORDER,
    });
    expect(asPatient.email).toBe('asha@example.com');
    const asPanel = await service.resolve({
      tenantId: TENANT,
      orderId: ORDER,
      recipientEmail: null,
    });
    expect(asPanel.email).toBe('');
    const asDoctor = await service.resolve({
      tenantId: TENANT,
      orderId: ORDER,
      recipientEmail: 'dr@clinic.com',
    });
    expect(asDoctor.email).toBe('dr@clinic.com');
  });

  it('never throws: a DB failure yields the blank baseline + recipient name', async () => {
    const { service } = build({ failOrder: true });
    const out = await service.resolve({
      tenantId: TENANT,
      orderId: ORDER,
      recipientName: 'Asha Rao',
    });
    expect(out.patient_name).toBe('Asha Rao');
    expect(out.order_number).toBe('');
    expect(Object.keys(out)).toHaveLength(NOTIFICATION_TAG_KEYS.length);
  });
});

describe('NotificationTagsService — {condition_name}', () => {
  const member = (
    relationship: string,
    mobile: string | null,
    anchorMobile: string | null = '9876500000',
  ) => ({
    ...patientRow,
    firstName: 'Rahul',
    mobile,
    familyMemberOf: [{ relationship, patient: { mobile: anchorMobile } }],
  });
  const conditionFor = async (patient: unknown) => {
    const { service } = build({ patient });
    const out = await service.resolve({ tenantId: TENANT, patientId: PATIENT });
    return out.condition_name;
  };

  it.each([
    ['not linked as a family member', patientRow, 'you'],
    [
      'member sharing the anchor mobile',
      member('SON', '9876500000'),
      'your son Rahul',
    ],
    [
      'member sharing it (spaces trimmed)',
      member('MOTHER', ' 9876500000 '),
      'your mother Rahul',
    ],
    [
      'member without a mobile',
      member('DAUGHTER', null),
      'your daughter Rahul',
    ],
    ['member with their OWN mobile', member('SON', '9000000001'), 'you'],
    ['SELF relationship', member('SELF', '9876500000'), 'you'],
    [
      'OTHER relationship',
      member('OTHER', '9876500000'),
      'your family member Rahul',
    ],
  ])('%s → %s', async (_label, patient, expected) => {
    expect(await conditionFor(patient)).toBe(expected);
  });

  it('is blank when the message has no patient', async () => {
    const { service } = build({});
    const out = await service.resolve({ tenantId: TENANT });
    expect(out.condition_name).toBe('');
  });

  it('is batched for manual compose too', async () => {
    const { service } = build({ patient: member('SPOUSE', null) });
    const map = await service.resolvePatientTags(TENANT, [PATIENT]);
    expect(map.get(PATIENT)?.condition_name).toBe('your spouse Rahul');
  });
});

describe('NotificationTagsService.resolvePatientTags', () => {
  it('batches patient-only tags for many recipients in one query', async () => {
    const { service, tx } = build({ patient: patientRow });
    const map = await service.resolvePatientTags(TENANT, [
      PATIENT,
      PATIENT,
      null,
    ]);
    expect(tx.patient.findMany).toHaveBeenCalledTimes(1);
    expect(map.get(PATIENT)).toEqual({
      pfn: 'Asha K Rao',
      patient: 'Asha K Rao',
      patient_unique_id: 'PAT-00042',
      condition_name: 'you',
      email: 'asha@example.com',
    });
  });

  it('skips the query when there are no patient ids', async () => {
    const { service, tx } = build({});
    const map = await service.resolvePatientTags(TENANT, [undefined]);
    expect(map.size).toBe(0);
    expect(tx.patient.findMany).not.toHaveBeenCalled();
  });
});
