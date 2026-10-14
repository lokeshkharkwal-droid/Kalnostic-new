import { DiscountMode, OrderStatus, RegistrationSetting } from '@prisma/client';
import { OrderService } from './order.service';
import { OrderItemDto } from './dto/order-item.dto';
import { OrderPaymentDto } from './dto/order-payment.dto';
import {
  OrderDiscountNotAllowedException,
  OrderDiscountOutOfRangeException,
  LineItemDiscountNotAllowedException,
  LineItemDiscountOutOfRangeException,
  TdsNotApplicableException,
  TdsOutOfRangeException,
} from './exceptions/order.exceptions';

/**
 * Unit coverage for the branch's TDS & Discount enforcement
 * (`assertDiscountAndTdsRules`) applied when finalizing an order — the API-level
 * mirror of the Registration Settings gating. The method is dependency-free, so
 * the service is instantiated with stubbed constructor args and the private
 * method is exercised directly.
 */
describe('OrderService — TDS & Discount rules', () => {
  // Instantiate with no-op deps: the validators under test read only their args.
  const service = new OrderService(
    ...(Array(8).fill(undefined) as unknown as ConstructorParameters<
      typeof OrderService
    >),
  );

  /** Build a full-ish settings row with sensible discount/TDS defaults. */
  const makeSettings = (
    overrides: Partial<RegistrationSetting> = {},
  ): RegistrationSetting =>
    ({
      ChargesAndDeductions_AllowDiscounts: true,
      ChargesAndDeductions_MinimumDiscountPercent: 5,
      ChargesAndDeductions_MaximumDiscountPercent: 20,
      ChargesAndDeductions_AllowLineItemDiscount: true,
      ChargesAndDeductions_MinimumLineItemDiscountPercent: 5,
      ChargesAndDeductions_MaximumLineItemDiscountPercent: 20,
      ChargesAndDeductions_TdsApplicable: true,
      ChargesAndDeductions_MinimumTdsPercent: 2,
      ChargesAndDeductions_MaximumTdsPercent: 5,
      ChargesAndDeductions_AllowOrderDiscountOnly: false,
      ChargesAndDeductions_AllowLineDiscountOnly: false,
      ChargesAndDeductions_AllowBothOrderAndLineDiscount: false,
      ...overrides,
    }) as RegistrationSetting;

  const itemKey = 'test-1';
  const itemPrices = new Map<string, number>([[itemKey, 1000]]);

  /** Invoke the private validator with defaults + overrides. */
  const run = (opts: {
    settings?: RegistrationSetting;
    items?: OrderItemDto[];
    payments?: OrderPaymentDto[];
  }) =>
    (
      service as unknown as {
        assertDiscountAndTdsRules: (p: unknown) => void;
      }
    ).assertDiscountAndTdsRules({
      status: OrderStatus.ORDER,
      branchId: 'b1',
      settings: opts.settings ?? makeSettings(),
      items: opts.items ?? [{ branchLabTestId: itemKey }],
      payments: opts.payments,
      itemPrices,
    });

  it('passes when nothing is discounted', () => {
    expect(() => run({})).not.toThrow();
  });

  it('is a no-op for non-ORDER statuses', () => {
    expect(() =>
      (
        service as unknown as {
          assertDiscountAndTdsRules: (p: unknown) => void;
        }
      ).assertDiscountAndTdsRules({
        status: OrderStatus.DRAFT,
        branchId: 'b1',
        settings: makeSettings({ ChargesAndDeductions_AllowDiscounts: false }),
        items: [{ branchLabTestId: itemKey, discount: 500 }],
        payments: [{ orderDiscount: 500 }],
        itemPrices,
      }),
    ).not.toThrow();
  });

  describe('line-item discount', () => {
    it('rejects a line discount when line discounts are disabled', () => {
      expect(() =>
        run({
          settings: makeSettings({
            ChargesAndDeductions_AllowLineItemDiscount: false,
          }),
          items: [
            {
              branchLabTestId: itemKey,
              discount: 100,
              discountMode: DiscountMode.PERCENT,
              discountValue: 10,
            },
          ],
        }),
      ).toThrow(LineItemDiscountNotAllowedException);
    });

    it('rejects a line discount above the maximum percentage', () => {
      expect(() =>
        run({
          items: [
            {
              branchLabTestId: itemKey,
              discount: 300,
              discountMode: DiscountMode.PERCENT,
              discountValue: 30, // max is 20
            },
          ],
        }),
      ).toThrow(LineItemDiscountOutOfRangeException);
    });

    it('rejects a line discount below the minimum percentage', () => {
      expect(() =>
        run({
          items: [
            {
              branchLabTestId: itemKey,
              discount: 10,
              discountMode: DiscountMode.PERCENT,
              discountValue: 1, // min is 5
            },
          ],
        }),
      ).toThrow(LineItemDiscountOutOfRangeException);
    });

    it('accepts an in-range AMOUNT-mode line discount (derives the %)', () => {
      expect(() =>
        run({
          items: [
            {
              branchLabTestId: itemKey,
              discount: 150, // 15% of 1000 → within [5,20]
              discountMode: DiscountMode.AMOUNT,
              discountValue: 150,
            },
          ],
        }),
      ).not.toThrow();
    });
  });

  describe('order-level discount', () => {
    it('rejects an order discount when order discounts are disabled', () => {
      expect(() =>
        run({
          settings: makeSettings({
            ChargesAndDeductions_AllowDiscounts: false,
          }),
          payments: [{ orderDiscount: 100 }],
        }),
      ).toThrow(OrderDiscountNotAllowedException);
    });

    it('rejects an order discount above the maximum percentage', () => {
      expect(
        () => run({ payments: [{ orderDiscount: 300 }] }), // 30% of 1000, max 20
      ).toThrow(OrderDiscountOutOfRangeException);
    });

    it('accepts an in-range order discount', () => {
      expect(
        () => run({ payments: [{ orderDiscount: 100 }] }), // 10% of 1000
      ).not.toThrow();
    });
  });

  describe('discount mode exclusivity', () => {
    it('Line-Only rejects an order discount but allows a line discount', () => {
      const settings = makeSettings({
        ChargesAndDeductions_AllowLineDiscountOnly: true,
      });
      expect(() =>
        run({ settings, payments: [{ orderDiscount: 100 }] }),
      ).toThrow(OrderDiscountNotAllowedException);
      expect(() =>
        run({
          settings,
          items: [
            {
              branchLabTestId: itemKey,
              discount: 100,
              discountMode: DiscountMode.PERCENT,
              discountValue: 10,
            },
          ],
        }),
      ).not.toThrow();
    });

    it('Order-Only rejects a line discount but allows an order discount', () => {
      const settings = makeSettings({
        ChargesAndDeductions_AllowOrderDiscountOnly: true,
      });
      expect(() =>
        run({
          settings,
          items: [
            {
              branchLabTestId: itemKey,
              discount: 100,
              discountMode: DiscountMode.PERCENT,
              discountValue: 10,
            },
          ],
        }),
      ).toThrow(LineItemDiscountNotAllowedException);
      expect(() =>
        run({ settings, payments: [{ orderDiscount: 100 }] }),
      ).not.toThrow();
    });
  });

  describe('TDS', () => {
    it('rejects TDS when it is not applicable', () => {
      expect(() =>
        run({
          settings: makeSettings({
            ChargesAndDeductions_TdsApplicable: false,
          }),
          payments: [{ tdsDeduction: 30 }],
        }),
      ).toThrow(TdsNotApplicableException);
    });

    it('rejects TDS above the maximum percentage', () => {
      // net = 1000 (no discount); 100/1000 = 10%, max is 5
      expect(() => run({ payments: [{ tdsDeduction: 100 }] })).toThrow(
        TdsOutOfRangeException,
      );
    });

    it('accepts in-range TDS computed against the net amount', () => {
      // net = 1000; 30/1000 = 3% → within [2,5]
      expect(() => run({ payments: [{ tdsDeduction: 30 }] })).not.toThrow();
    });
  });

  describe('direct entry item pricing', () => {
    it('uses a direct item unitPrice for its line-discount % check', () => {
      expect(() =>
        run({
          items: [
            {
              direct: 'ABC',
              unitPrice: 1000,
              discount: 300, // 30% of 1000, max is 20
              discountMode: DiscountMode.PERCENT,
              discountValue: 30,
            },
          ],
        }),
      ).toThrow(LineItemDiscountOutOfRangeException);
    });

    it('accepts an in-range discount on a priced direct item', () => {
      expect(() =>
        run({
          items: [
            {
              direct: 'ABC',
              unitPrice: 1000,
              discount: 150,
              discountMode: DiscountMode.PERCENT,
              discountValue: 15,
            },
          ],
        }),
      ).not.toThrow();
    });

    it("includes a direct item's unitPrice in the order-level discount % base", () => {
      // Previously a direct item always priced at 0 ⇒ itemsGross stayed 0 ⇒
      // any order discount was wrongly rejected as "no positive base". With
      // unitPrice wired through, 100/1000 = 10%, within [5,20].
      expect(() =>
        run({
          items: [{ direct: 'ABC', unitPrice: 1000 }],
          payments: [{ orderDiscount: 100 }],
        }),
      ).not.toThrow();
    });

    it('treats a direct item with no unitPrice as zero price (matches prior default, no throw)', () => {
      expect(() =>
        run({
          items: [
            {
              direct: 'ABC',
              discount: 50,
              discountMode: DiscountMode.AMOUNT,
              discountValue: 50,
            },
          ],
        }),
      ).not.toThrow();
    });
  });
});

/**
 * Unit coverage for the `referral_patient_bill_print` render context — the
 * legacy `{SIGNATURE_NAME}` / `{ORDER.DATE}` tags must resolve on that type and
 * must NOT leak onto the plain patient bill. The builders only touch
 * `prisma.person` (actor names) and `tenantService.getLocale`, so those two are
 * stubbed and the private dispatcher is exercised directly.
 */
describe('OrderService — referral patient bill print context', () => {
  const creatorId = 'person-creator';
  const prisma = {
    person: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: creatorId,
          firstName: 'Branch',
          middleName: null,
          lastName: 'Admin',
        },
      ]),
    },
  };
  const tenantService = {
    getLocale: jest.fn().mockResolvedValue({
      timezone: 'Asia/Kolkata',
      dateFormat: 'DD/MM/YYYY',
      timeFormat: '12h',
    }),
  };
  const deps = Array(13).fill(undefined) as unknown[];
  deps[0] = prisma;
  deps[11] = tenantService;
  const service = new OrderService(
    ...(deps as ConstructorParameters<typeof OrderService>),
  );

  /** A minimal order: no items/payments, created by `creatorId` on 10 Sep 2026. */
  const order = {
    id: 'order-1',
    orderCode: 'ORD-1',
    billId: 'DIG-001',
    status: OrderStatus.ORDER,
    orderDate: new Date('2026-09-10T00:00:00.000Z'),
    orderTime: '10:30',
    createdAt: new Date('2026-09-24T06:00:00.000Z'),
    createdBy: creatorId,
    items: [],
    payments: [],
    diagnostics: null,
    discountAmount: 0,
    netAmount: 0,
    paidAmount: 0,
    cancellationCharge: 0,
    branch: { name: 'Main Branch' },
    referredByDoctor: null,
    referralPanel: { name: 'Test Credit Panel' },
    patient: {
      firstName: 'Asha',
      middleName: null,
      lastName: 'Verma',
      salutation: null,
      dateOfBirth: null,
      age: null,
      ageType: null,
      gender: null,
      umId: 'UM-1',
      mobile: '9000000000',
      email: null,
      bloodGroup: null,
      addressLine1: null,
    },
  };

  /** Invoke the private per-type dispatcher against `order` + overrides. */
  const buildContext = (
    type: string,
    overrides: Record<string, unknown> = {},
  ) =>
    (
      service as unknown as {
        buildPrintContext: (
          o: unknown,
          t: string,
          tenantId: string,
        ) => Promise<{ variables?: Record<string, unknown> }>;
      }
    ).buildPrintContext({ ...order, ...overrides }, type, 'tenant-1');

  it('resolves signature_name to the order creator and order.date to the order date', async () => {
    const { variables = {} } = await buildContext(
      'referral_patient_bill_print',
    );
    expect(variables.signature_name).toBe('Branch Admin');
    expect(variables['order.date']).toBe('10/09/2026');
    expect(variables['order.date']).toBe(variables.order_date);
    // Still a superset of the patient bill's tags.
    expect(variables.bill_id).toBe('DIG-001');
    expect(variables.referral_panel).toBe('Test Credit Panel');
  });

  it('leaves signature_name blank when the order has no creator', async () => {
    const { variables = {} } = await buildContext(
      'referral_patient_bill_print',
      { createdBy: null },
    );
    expect(variables.signature_name).toBe('');
  });

  it('does not add the referral-only tags to the plain patient bill', async () => {
    const { variables = {} } = await buildContext('bill_print');
    expect(variables).not.toHaveProperty('signature_name');
    expect(variables).not.toHaveProperty('order.date');
  });
});

/**
 * Unit coverage for the `trf_print` (Test Requisition Form) Diagnostics tags —
 * `{home_visit}` / `{home_visit_charge}` / `{sample_charge}` must resolve on
 * the TRF from the order's Diagnostics section (the visit charge with the same
 * Home-Visit-on rule as the bill), and none may leak onto the order slip /
 * quotation. Same harness as the referral-bill block above: only
 * `prisma.person` (bill collector name) and `tenantService.getLocale` are
 * stubbed, and an item-less order keeps `itemRowsWithPanelTests` off Prisma.
 */
describe('OrderService — TRF print context (Diagnostics tags)', () => {
  const prisma = {
    person: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const tenantService = {
    getLocale: jest.fn().mockResolvedValue({
      timezone: 'Asia/Kolkata',
      dateFormat: 'DD/MM/YYYY',
      timeFormat: '12h',
    }),
  };
  const deps = Array(13).fill(undefined) as unknown[];
  deps[0] = prisma;
  deps[11] = tenantService;
  const service = new OrderService(
    ...(deps as ConstructorParameters<typeof OrderService>),
  );

  /** A minimal home-visit order: visit charge 500, sample charge 600. */
  const order = {
    id: 'order-1',
    orderCode: 'ORD-1',
    billId: 'DIG-001',
    status: OrderStatus.ORDER,
    orderDate: new Date('2026-09-10T00:00:00.000Z'),
    orderTime: '10:30',
    orderNotes: null,
    createdAt: new Date('2026-09-24T06:00:00.000Z'),
    createdBy: null,
    items: [],
    payments: [],
    diagnostics: {
      isHomeVisit: true,
      visitCharges: 500,
      sampleCollectionCharges: 600,
    },
    discountAmount: 0,
    netAmount: 0,
    paidAmount: 0,
    cancellationCharge: 0,
    branch: { name: 'Main Branch' },
    referredByDoctor: null,
    referralPanel: null,
    patient: {
      firstName: 'Asha',
      middleName: null,
      lastName: 'Verma',
      salutation: null,
      dateOfBirth: null,
      age: null,
      ageType: null,
      gender: null,
      umId: 'UM-1',
      mobile: '9000000000',
      email: null,
      bloodGroup: null,
      addressLine1: null,
    },
  };

  /** Invoke the private per-type dispatcher against `order` + overrides. */
  const buildContext = (
    type: string,
    overrides: Record<string, unknown> = {},
  ) =>
    (
      service as unknown as {
        buildPrintContext: (
          o: unknown,
          t: string,
          tenantId: string,
        ) => Promise<{ variables?: Record<string, unknown> }>;
      }
    ).buildPrintContext({ ...order, ...overrides }, type, 'tenant-1');

  it('resolves home_visit / home_visit_charge / sample_charge on the TRF', async () => {
    const { variables = {} } = await buildContext('trf_print');
    expect(variables.home_visit).toBe('Yes');
    expect(variables.home_visit_charge).toBe(500);
    expect(variables.sample_charge).toBe(600);
    // Existing TRF tags are untouched.
    expect(variables.trf_ref).toBe('DIG-001');
    expect(variables.order_code).toBe('ORD-1');
  });

  it('reads No + the sample charge when Home Visit is off', async () => {
    const { variables = {} } = await buildContext('trf_print', {
      diagnostics: {
        isHomeVisit: false,
        visitCharges: 0,
        sampleCollectionCharges: 100,
      },
    });
    expect(variables.home_visit).toBe('No');
    expect(variables.home_visit_charge).toBe(0);
    expect(variables.sample_charge).toBe(100);
  });

  it('reads a 0 visit charge on the TRF when a stale charge remains after Home Visit was turned off', async () => {
    const { variables = {} } = await buildContext('trf_print', {
      diagnostics: {
        isHomeVisit: false,
        visitCharges: 500,
        sampleCollectionCharges: 0,
      },
    });
    expect(variables.home_visit_charge).toBe(0);
  });

  it('reads No / 0 when the order has no Diagnostics section', async () => {
    const { variables = {} } = await buildContext('trf_print', {
      diagnostics: null,
    });
    expect(variables.home_visit).toBe('No');
    expect(variables.home_visit_charge).toBe(0);
    expect(variables.sample_charge).toBe(0);
  });

  it('keeps all three Diagnostics tags on the patient bill', async () => {
    const { variables = {} } = await buildContext('bill_print');
    expect(variables.home_visit).toBe('Yes');
    expect(variables.home_visit_charge).toBe(500);
    expect(variables.sample_charge).toBe(600);
  });

  it.each([
    ['only the sample charge', false, 0, 600, 0, 600],
    ['only the visit charge', true, 500, 0, 500, 0],
    ['neither charge', false, 0, 0, 0, 0],
    ['a stale visit charge after Home Visit was turned off', false, 500, 0, 0, 0],
  ])(
    'resolves the bill charge tags with %s',
    async (_label, isHomeVisit, visitCharges, sampleCollectionCharges, visit, sample) => {
      const { variables = {} } = await buildContext('bill_print', {
        diagnostics: { isHomeVisit, visitCharges, sampleCollectionCharges },
      });
      expect(variables.home_visit_charge).toBe(visit);
      expect(variables.sample_charge).toBe(sample);
    },
  );

  it('reads 0 / 0 on the patient bill when the order has no Diagnostics section', async () => {
    const { variables = {} } = await buildContext('bill_print', {
      diagnostics: null,
    });
    expect(variables.home_visit_charge).toBe(0);
    expect(variables.sample_charge).toBe(0);
  });

  it('carries both bill charge tags onto the accounts billing document', async () => {
    const { variables = {} } = await buildContext('accounts_biling');
    expect(variables.home_visit_charge).toBe(500);
    expect(variables.sample_charge).toBe(600);
  });

  it.each(['order_print', 'lab_quotation_print'])(
    'does not add the Diagnostics tags to %s',
    async (type) => {
      const { variables = {} } = await buildContext(type);
      expect(variables).not.toHaveProperty('home_visit');
      expect(variables).not.toHaveProperty('home_visit_charge');
      expect(variables).not.toHaveProperty('sample_charge');
    },
  );
});

/**
 * Unit coverage for the `lab_quotation_print` legacy tags — `{EXT_QUOTE_ID}`,
 * the flat dotted aliases (`{PATIENT.FULL_NAME}`, `{ORDER.REFERRING_DOCTOR}`,
 * `{ORDER.REFERRING_PANEL}`, `{BILL.TOTAL}`) and the per-row `{ITEM.INDEX}` /
 * `{ITEM.NAME}` / `{item.price}` aliases must resolve on the quotation (each
 * row carrying its own values, next to its own `panel_tests_name`), and must
 * NOT leak onto the other order documents. Same harness as the blocks above,
 * plus the two panel-member lookups `itemRowsWithPanelTests` makes.
 */
describe('OrderService — lab quotation print context (legacy tags)', () => {
  const prisma = {
    person: { findMany: jest.fn().mockResolvedValue([]) },
    branchLabPanelTest: {
      findMany: jest.fn().mockResolvedValue([
        { branchLabPanelId: 'panel-1', branchLabTestId: 'test-a' },
        { branchLabPanelId: 'panel-1', branchLabTestId: 'test-b' },
      ]),
    },
    branchLabTest: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'test-a', testName: 'RA Factor' },
        { id: 'test-b', testName: 'KFT' },
      ]),
    },
  };
  const tenantService = {
    getLocale: jest.fn().mockResolvedValue({
      timezone: 'Asia/Kolkata',
      dateFormat: 'DD/MM/YYYY',
      timeFormat: '12h',
    }),
  };
  const deps = Array(13).fill(undefined) as unknown[];
  deps[0] = prisma;
  deps[11] = tenantService;
  const service = new OrderService(
    ...(deps as ConstructorParameters<typeof OrderService>),
  );

  /** A quote with a test, a panel and a direct line at three different prices. */
  const order = {
    id: 'order-1',
    orderCode: 'ORD-1',
    billId: null,
    externalOrderId: 'QT-0042',
    status: OrderStatus.QUOTE,
    quotationStatus: 'DRAFT',
    quotationValidTill: null,
    orderDate: new Date('2026-09-10T00:00:00.000Z'),
    orderTime: null,
    orderNotes: null,
    createdAt: new Date('2026-09-24T06:00:00.000Z'),
    createdBy: null,
    items: [
      {
        branchLabTest: { testName: 'CBC', testCode: 'CBC01' },
        branchLabPanel: null,
        direct: null,
        unitPrice: 300,
        discount: 0,
      },
      {
        branchLabTest: null,
        branchLabPanel: {
          id: 'panel-1',
          panelName: 'Health Panel',
          panelCode: 'HP01',
        },
        direct: null,
        unitPrice: 1200,
        discount: 0,
      },
      {
        branchLabTest: null,
        branchLabPanel: null,
        direct: 'Home Kit',
        unitPrice: 150,
        discount: 0,
      },
    ],
    payments: [
      {
        totalAmount: 1650,
        orderDiscount: 100,
        netAmount: 1550,
        paidAmount: 0,
      },
    ],
    diagnostics: null,
    discountAmount: 100,
    netAmount: 1550,
    paidAmount: 0,
    cancellationCharge: 0,
    branch: { name: 'Main Branch' },
    referredByDoctor: { firstName: 'Rohit', lastName: 'Sharma' },
    referralPanel: { name: 'Apollo Panel' },
    patient: {
      firstName: 'Asha',
      middleName: 'K',
      lastName: 'Verma',
      salutation: null,
      dateOfBirth: null,
      age: null,
      ageType: null,
      gender: null,
      umId: 'UM-1',
      mobile: '9000000000',
      email: null,
      bloodGroup: null,
      addressLine1: null,
    },
  };

  type Ctx = {
    variables?: Record<string, unknown>;
    sections?: Record<string, Array<Record<string, unknown>>>;
  };

  /** Invoke the private per-type dispatcher against `order` + overrides. */
  const buildContext = (
    type: string,
    overrides: Record<string, unknown> = {},
  ): Promise<Ctx> =>
    (
      service as unknown as {
        buildPrintContext: (
          o: unknown,
          t: string,
          tenantId: string,
        ) => Promise<Ctx>;
      }
    ).buildPrintContext({ ...order, ...overrides }, type, 'tenant-1');

  it('resolves ext_quote_id to the external quote id, blank when there is none', async () => {
    const { variables = {} } = await buildContext('lab_quotation_print');
    expect(variables.ext_quote_id).toBe('QT-0042');
    // The internal quote id is untouched.
    expect(variables.quote_id).toBe('ORD-1');

    const noExt = await buildContext('lab_quotation_print', {
      externalOrderId: null,
    });
    expect(noExt.variables?.ext_quote_id).toBe('');
  });

  it('aliases the dotted patient / referral / total tags to their base keys', async () => {
    const { variables = {} } = await buildContext('lab_quotation_print');
    expect(variables['patient.full_name']).toBe('Asha K Verma');
    expect(variables['patient.full_name']).toBe(variables.patient_name);
    expect(variables['order.referring_doctor']).toBe('Rohit Sharma');
    expect(variables['order.referring_doctor']).toBe(variables.referred_by);
    expect(variables['order.referring_panel']).toBe('Apollo Panel');
    expect(variables['order.referring_panel']).toBe(variables.referral_panel);
    expect(variables['bill.total']).toBe(1550);
    expect(variables['bill.total']).toBe(variables.net_amount);
  });

  it('keeps the Self / Walk-in referral fallbacks on the dotted aliases', async () => {
    const { variables = {} } = await buildContext('lab_quotation_print', {
      referredByDoctor: null,
      referralPanel: null,
    });
    expect(variables['order.referring_doctor']).toBe('Self');
    expect(variables['order.referring_panel']).toBe('Walk-in');
  });

  it('gives every item row its own index, name, price and panel tests', async () => {
    const { sections = {} } = await buildContext('lab_quotation_print');
    const rows = sections.items ?? [];
    expect(
      rows.map((r) => [
        r['item.index'],
        r['item.name'],
        r['item.price'],
        r.panel_tests_name,
      ]),
    ).toEqual([
      [1, 'CBC', 300, ''],
      [2, 'Health Panel', 1200, 'RA Factor, KFT'],
      [3, 'Home Kit', 150, ''],
    ]);
    // The aliases mirror the existing row fields, which stay in place.
    for (const r of rows) {
      expect(r['item.index']).toBe(r.sr_no);
      expect(r['item.name']).toBe(r.name);
      expect(r['item.price']).toBe(r.price);
    }
  });

  it('keeps the item aliases off the top-level variables', async () => {
    const { variables = {} } = await buildContext('lab_quotation_print');
    expect(variables).not.toHaveProperty('item.index');
    expect(variables).not.toHaveProperty('item.name');
    expect(variables).not.toHaveProperty('item.price');
    // The flat panel list still covers the whole quote.
    expect(variables.panel_tests_name).toBe('RA Factor, KFT');
  });

  it.each(['bill_print', 'order_print', 'trf_print'])(
    'does not add the quotation-only tags to %s',
    async (type) => {
      const { variables = {}, sections = {} } = await buildContext(type);
      for (const key of [
        'ext_quote_id',
        'patient.full_name',
        'order.referring_doctor',
        'order.referring_panel',
        'bill.total',
      ]) {
        expect(variables).not.toHaveProperty(key);
      }
      const rows = sections.items ?? sections.tests ?? [];
      expect(rows.length).toBe(3);
      for (const r of rows) {
        expect(r).not.toHaveProperty('item.index');
        expect(r).not.toHaveProperty('item.name');
        expect(r).not.toHaveProperty('item.price');
      }
    },
  );
});
