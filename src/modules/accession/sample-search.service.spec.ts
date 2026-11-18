import { SampleStatus, TransferKind, TransferStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UserDepartmentScopeService } from '../department/user-department-scope.service';
import { OrderSampleService } from './accession-sample.service';
import { SampleSearchService } from './sample-search.service';
import type { SampleSearchFound } from './entities/sample-search.entity';

/** The Sample Search lookup: where each menu looks, the sections per status, and the buttons of each. */
describe('SampleSearchService', () => {
  type SampleOver = Partial<{
    id: string;
    status: SampleStatus;
    branchId: string;
    originBranchId: string;
    orderId: string;
    barcode: string | null;
    barcodeBeforeRepeat: string | null;
    isRecoverable: boolean | null;
    returnedVerifiedAt: Date | null;
    sourceTransferId: string | null;
    orderStatus: string;
    orderBranchId: string;
    itemRemoved: boolean;
  }>;

  const sample = (o: SampleOver = {}) => ({
    id: o.id ?? 's1',
    status: o.status ?? SampleStatus.ACCEPTED,
    branchId: o.branchId ?? 'b1',
    originBranchId: o.originBranchId ?? 'b1',
    processingBranchId: o.branchId ?? 'b1',
    orderId: o.orderId ?? 'o1',
    departmentId: 'd1',
    sampleType: 'Serum',
    containerType: 'SST',
    barcode: o.barcode === undefined ? '10050' : o.barcode,
    barcodeBeforeRepeat: o.barcodeBeforeRepeat ?? null,
    isRecoverable: o.isRecoverable ?? null,
    returnedVerifiedAt: o.returnedVerifiedAt ?? null,
    sourceTransferId: o.sourceTransferId ?? null,
    createdAt: new Date(),
    order: {
      id: o.orderId ?? 'o1',
      orderCode: 'ORD-1',
      externalOrderId: null,
      status: o.orderStatus ?? 'CONFIRMED',
      branchId: o.orderBranchId ?? 'b1',
    },
    tests: [
      {
        orderItemId: `i-${o.id ?? 's1'}`,
        labTestId: 'lt1',
        testName: `Test ${o.id ?? 's1'}`,
        orderItem: {
          deletedAt: o.itemRemoved ? new Date() : null,
          branchLabTestId: 'blt1',
          branchLabTest: {
            departmentId: 'd1',
            categoryId: 'c1',
            subCategoryId: 'sc1',
          },
        },
      },
    ],
  });

  const world = (opts: {
    samples?: ReturnType<typeof sample>[];
    /** Samples that wait for a new tube: no barcode now, the barcode a Repeat took off is remembered. */
    waiting?: ReturnType<typeof sample>[];
    /** The new barcode of a sample whose old barcode was taken off by a Repeat (for the "replaced by" answer). */
    replacedBy?: string;
    transfers?: Array<Record<string, unknown>>;
    referral?: Array<Record<string, unknown>>;
    referralCount?: number;
    gate?: {
      gated: boolean;
      unpublished: number;
      unpublishedSampleIds?: string[];
    };
    /** What the server would refuse for the report's state: Repeat (validated result), Send/Forward/Outsource (worked on). */
    blocks?: { repeat: boolean; dispatch: boolean };
    /** Whether a Retrieve would be refused because a report is past Pending. */
    retrieveRefused?: boolean;
    scope?: string[];
    reportStatus?: string;
  }) => {
    const live = opts.samples ?? [];
    const waiting = opts.waiting ?? [];
    const rows = [...live, ...waiting];
    const tx = {
      orderSample: {
        // two lookups: the samples that carry the barcode, then the ones that wait for a new tube
        // (`barcode: null`, narrowed to the live order when there is one)
        findMany: jest
          .fn()
          .mockImplementation(
            (args: { where: { barcode?: unknown; orderId?: string } }) =>
              Promise.resolve(
                args.where.barcode === null
                  ? waiting.filter(
                      (w) =>
                        !args.where.orderId || w.orderId === args.where.orderId,
                    )
                  : live,
              ),
          ),
        findFirst: jest
          .fn()
          .mockResolvedValue(
            opts.replacedBy ? { barcode: opts.replacedBy } : null,
          ),
      },
      sampleTransfer: {
        findMany: jest
          .fn()
          .mockImplementation((args: { select: Record<string, unknown> }) =>
            Promise.resolve(
              'sample' in args.select
                ? (opts.referral ?? [])
                : (opts.transfers ?? []),
            ),
          ),
        count: jest.fn().mockResolvedValue(opts.referralCount ?? 0),
      },
      orderSampleTest: {
        findMany: jest.fn().mockImplementation(() =>
          Promise.resolve(
            rows.map((r) => ({
              sampleId: r.id,
              orderItem: { deletedAt: r.tests[0]!.orderItem.deletedAt },
            })),
          ),
        ),
      },
      labReport: {
        findMany: jest.fn().mockResolvedValue(
          rows.map((r) => ({
            orderItemId: r.tests[0]!.orderItemId,
            labTestId: null,
            memberBranchLabTestId: null,
            status: opts.reportStatus ?? 'PENDING',
          })),
        ),
      },
      branchLabTest: { findMany: jest.fn().mockResolvedValue([]) },
      department: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'd1', name: 'Biochemistry' }]),
      },
      category: {
        findMany: jest.fn().mockResolvedValue([{ id: 'c1', name: 'Profiles' }]),
      },
      subCategory: {
        findMany: jest.fn().mockResolvedValue([{ id: 'sc1', name: 'Liver' }]),
      },
      branch: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'b1', name: 'Main' },
          { id: 'b2', name: 'Other' },
        ]),
      },
      outsourceCenter: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const prisma = {
      withTenant: jest.fn((_t: string, cb: (t: typeof tx) => unknown) =>
        cb(tx),
      ),
    };
    const samples = {
      storeReturnGate: jest.fn().mockResolvedValue({
        unpublishedSampleIds: [],
        ...(opts.gate ?? { gated: true, unpublished: 0 }),
      }),
      reportBlocksFor: jest
        .fn()
        .mockResolvedValue(opts.blocks ?? { repeat: false, dispatch: false }),
      retrieveRefusedByStartedReport: jest
        .fn()
        .mockResolvedValue(opts.retrieveRefused ?? false),
    };
    const scope = {
      resolveDepartmentIds: jest.fn().mockResolvedValue(opts.scope ?? []),
    };
    const service = new SampleSearchService(
      prisma as unknown as PrismaService,
      samples as unknown as OrderSampleService,
      scope as unknown as UserDepartmentScopeService,
    );
    const search = (
      menu: 'IN_HOUSE' | 'INTERNAL' | 'EXTERNAL',
      code = '10050',
    ) => service.search('t1', 'b1', 'p1', { barcode: code, menu });
    return { tx, samples, search };
  };

  const found = (
    r: Awaited<ReturnType<ReturnType<typeof world>['search']>>,
  ) => {
    expect(r.found).toBe(true);
    return r as SampleSearchFound;
  };

  describe('In-House', () => {
    it("looks at this branch's live samples with the barcode, ignoring case, with the department scope", async () => {
      const { tx, search } = world({ samples: [sample()], scope: ['d1'] });
      await search('IN_HOUSE');
      const where = (
        tx.orderSample.findMany.mock.calls[0] as [
          { where: Record<string, unknown> },
        ]
      )[0].where;
      expect(where).toMatchObject({
        tenantId: 't1',
        branchId: 'b1',
        deletedAt: null,
        barcode: { equals: '10050', mode: 'insensitive' },
        OR: [{ departmentId: null }, { departmentId: { in: ['d1'] } }],
      });
    });

    describe('a barcode a Repeat took off (the sample waits for a new tube)', () => {
      const waitingRepeat = (id = 'w1', orderId = 'o1') =>
        sample({
          id,
          orderId,
          status: SampleStatus.REPEAT,
          barcode: null,
          barcodeBeforeRepeat: '10050',
        });

      it('finds a sample that has no barcode but remembers the scanned one, with the Repeat row and a note', async () => {
        const r = found(
          await world({ waiting: [waitingRepeat()] }).search('IN_HOUSE'),
        );
        expect(r.sections).toHaveLength(1);
        expect(r.sections[0]).toMatchObject({
          status: SampleStatus.REPEAT,
          barcodeTakenOff: '10050',
          actions: ['Collect', 'Collect & Print', 'Hold', 'Cancel', 'Retrieve'],
        });
        // the barcode shown is the one that was scanned (the sample has none)
        expect(r.barcode).toBe('10050');
      });

      it('shows a repeated test next to the tests that still carry the tube barcode, as its own section', async () => {
        const r = found(
          await world({
            samples: [sample({ id: 's1' })],
            waiting: [waitingRepeat('w1')],
          }).search('IN_HOUSE'),
        );
        expect(
          r.sections.map((s) => [s.status, s.barcodeTakenOff, s.rows.length]),
        ).toEqual([
          [SampleStatus.ACCEPTED, null, 1],
          [SampleStatus.REPEAT, '10050', 1],
        ]);
      });

      it('looks for waiting samples only without a barcode, within the live order, branch and department scope', async () => {
        const { tx, search } = world({
          samples: [sample({ id: 's1' })],
          waiting: [waitingRepeat('w1')],
          scope: ['d1'],
        });
        await search('IN_HOUSE');
        const calls = tx.orderSample.findMany.mock.calls as unknown as [
          { where: Record<string, unknown> },
        ][];
        expect(calls).toHaveLength(2);
        expect(calls[1]![0].where).toMatchObject({
          tenantId: 't1',
          branchId: 'b1',
          deletedAt: null,
          barcode: null,
          barcodeBeforeRepeat: { equals: '10050', mode: 'insensitive' },
          orderId: 'o1',
          OR: [{ departmentId: null }, { departmentId: { in: ['d1'] } }],
        });
      });

      it('does not narrow to an order when no sample carries the barcode', async () => {
        const { tx, search } = world({ waiting: [waitingRepeat()] });
        await search('IN_HOUSE');
        const calls = tx.orderSample.findMany.mock.calls as unknown as [
          { where: Record<string, unknown> },
        ][];
        expect(calls[1]![0].where).not.toHaveProperty('orderId');
      });

      it('never lets a waiting sample of another order replace the order that carries the barcode (no tube mix-up)', async () => {
        const r = found(
          await world({
            samples: [sample({ id: 's1', orderId: 'o1' })],
            waiting: [waitingRepeat('w2', 'o2')],
          }).search('IN_HOUSE'),
        );
        expect(r.order.id).toBe('o1');
        expect(r.sections.map((s) => s.status)).toEqual([
          SampleStatus.ACCEPTED,
        ]);
      });

      it('a sample that waits in Hold or was cancelled after the Repeat is found too, with its own buttons', async () => {
        const r = found(
          await world({
            waiting: [
              sample({
                id: 'h1',
                status: SampleStatus.HOLD,
                barcode: null,
                barcodeBeforeRepeat: '10050',
              }),
              sample({
                id: 'c1',
                status: SampleStatus.CANCELLED,
                barcode: null,
                barcodeBeforeRepeat: '10050',
              }),
            ],
          }).search('IN_HOUSE'),
        );
        expect(r.sections.map((s) => [s.status, s.actions])).toEqual([
          [
            SampleStatus.HOLD,
            ['Collect', 'Collect & Print', 'Cancel', 'Retrieve'],
          ],
          [SampleStatus.CANCELLED, ['Retrieve']],
        ]);
      });

      it('says "replaced by" with the new barcode when the sample has one now, and opens nothing', async () => {
        const r = await world({ replacedBy: '10051' }).search('IN_HOUSE');
        expect(r).toMatchObject({ found: false, replacedBy: '10051' });
      });

      it('has no replacement when nothing is remembered', async () => {
        const r = await world({}).search('IN_HOUSE');
        expect(r).toMatchObject({ found: false, replacedBy: null });
      });

      it('never reports the barcode as replaced by itself (a restored barcode)', async () => {
        const r = await world({ replacedBy: '10050' }).search('IN_HOUSE');
        expect(r).toMatchObject({ found: false, replacedBy: null });
      });

      it('looks for the replacement only among samples that have a barcode now, in this branch', async () => {
        const { tx, search } = world({ replacedBy: '10051', scope: ['d1'] });
        await search('IN_HOUSE');
        const args = (
          tx.orderSample.findFirst.mock.calls as unknown as [
            { where: Record<string, unknown> },
          ][]
        )[0]![0];
        expect(args.where).toMatchObject({
          tenantId: 't1',
          branchId: 'b1',
          deletedAt: null,
          barcode: { not: null },
          barcodeBeforeRepeat: { equals: '10050', mode: 'insensitive' },
          OR: [{ departmentId: null }, { departmentId: { in: ['d1'] } }],
        });
      });
    });

    describe('wildcard characters in the barcode', () => {
      const whereOf = async (code: string) => {
        const { tx, search } = world({ samples: [sample()] });
        await search('IN_HOUSE', code);
        return (
          tx.orderSample.findMany.mock.calls[0] as [
            { where: { barcode: Record<string, unknown> } },
          ]
        )[0].where.barcode;
      };

      it('ignores capitals for an ordinary barcode', async () => {
        expect(await whereOf('AbC-77')).toEqual({
          equals: 'AbC-77',
          mode: 'insensitive',
        });
      });

      it.each(['9901_', 'LAB_10001'])(
        'uses plain equality for %s, so an underscore is never a wildcard (9901_ must not open 99011)',
        async (code) => {
          expect(await whereOf(code)).toEqual({ equals: code });
        },
      );
    });

    it('answers "not found" with the other menus that have the barcode', async () => {
      const { search } = world({ samples: [], referralCount: 2 });
      const r = await search('IN_HOUSE');
      expect(r).toMatchObject({
        found: false,
        menu: 'IN_HOUSE',
        barcode: '10050',
      });
      expect((r as { foundIn: string[] }).foundIn).toEqual([
        'INTERNAL',
        'EXTERNAL',
        'OUTSOURCE',
      ]);
    });

    it('gives the tests with department, category, subcategory and report status', async () => {
      const r = found(
        await world({ samples: [sample()], reportStatus: 'SAVED' }).search(
          'IN_HOUSE',
        ),
      );
      expect(r.sections).toHaveLength(1);
      expect(r.sections[0]!.rows[0]).toMatchObject({
        testName: 'Test s1',
        department: 'Biochemistry',
        category: 'Profiles',
        subcategory: 'Liver',
        reportStatus: 'SAVED',
      });
    });

    it('splits a barcode into one section per status', async () => {
      const r = found(
        await world({
          samples: [
            sample({ id: 's1', status: SampleStatus.ACCEPTED }),
            sample({ id: 's2', status: SampleStatus.COLLECTED }),
            sample({ id: 's3', status: SampleStatus.ACCEPTED }),
          ],
        }).search('IN_HOUSE'),
      );
      expect(r.sections.map((s) => [s.status, s.rows.length])).toEqual([
        [SampleStatus.ACCEPTED, 2],
        [SampleStatus.COLLECTED, 1],
      ]);
    });

    it("shows billing only for an order registered at the caller's own branch", async () => {
      expect(
        found(await world({ samples: [sample()] }).search('IN_HOUSE')).order
          .billingVisible,
      ).toBe(true);
      expect(
        found(
          await world({ samples: [sample({ orderBranchId: 'b2' })] }).search(
            'IN_HOUSE',
          ),
        ).order.billingVisible,
      ).toBe(false);
    });

    describe('buttons', () => {
      const actionsOf = async (
        o: SampleOver,
        extra: Parameters<typeof world>[0] = {},
      ) =>
        found(
          await world({ samples: [sample(o)], ...extra }).search('IN_HOUSE'),
        ).sections[0]!;

      it("Accepted: the document's seven buttons when every test is published", async () => {
        const s = await actionsOf({ status: SampleStatus.ACCEPTED });
        expect(s.actions).toEqual([
          'Store',
          'Repeat',
          'Return',
          'Send',
          'Forward',
          'Outsource',
          'Retrieve',
        ]);
      });

      it('Accepted: Store and Return are missing, with the reason, while a test is not published', async () => {
        const s = await actionsOf(
          { status: SampleStatus.ACCEPTED },
          { gate: { gated: true, unpublished: 2 } },
        );
        expect(s.actions).toEqual([
          'Repeat',
          'Send',
          'Forward',
          'Outsource',
          'Retrieve',
        ]);
        expect(s.hiddenActionReasons).toEqual({
          Store: '2 tests are not published yet.',
          Return: '2 tests are not published yet.',
        });
      });

      it('Accepted, every test unpublished but one is hidden from a department-scoped person: the reason says so', async () => {
        // s1 is the only test the person can see; s2 (another department) is not published either
        const s = await actionsOf(
          { status: SampleStatus.ACCEPTED },
          {
            gate: { gated: true, unpublished: 1, unpublishedSampleIds: ['s2'] },
          },
        );
        expect(s.actions).not.toContain('Store');
        expect(s.hiddenActionReasons.Store).toBe(
          '1 test in a department you cannot see is not published yet.',
        );
      });

      it('Accepted: a visible and a hidden unpublished test are both counted in the reason', async () => {
        const s = await actionsOf(
          { status: SampleStatus.ACCEPTED },
          {
            gate: {
              gated: true,
              unpublished: 3,
              unpublishedSampleIds: ['s1', 's2', 's3'],
            },
          },
        );
        expect(s.hiddenActionReasons.Return).toBe(
          '1 test is not published yet, and 2 tests in a department you cannot see are not published yet.',
        );
      });

      it('Accepted: every test published -> the server would refuse Repeat, so Repeat is hidden with the reason', async () => {
        const s = await actionsOf(
          { status: SampleStatus.ACCEPTED },
          { blocks: { repeat: true, dispatch: false } },
        );
        expect(s.actions).not.toContain('Repeat');
        expect(s.actions).toEqual(
          expect.arrayContaining([
            'Store',
            'Return',
            'Send',
            'Forward',
            'Outsource',
          ]),
        );
        expect(s.hiddenActionReasons.Repeat).toMatch(/validated/);
      });

      it('Accepted: a worked-on report hides Send, Forward and Outsource (each with the reason) but not Repeat', async () => {
        const s = await actionsOf(
          { status: SampleStatus.ACCEPTED },
          { blocks: { repeat: false, dispatch: true } },
        );
        expect(s.actions).toEqual(['Store', 'Repeat', 'Return', 'Retrieve']);
        for (const label of ['Send', 'Forward', 'Outsource']) {
          expect(s.hiddenActionReasons[label]).toMatch(/worked on/);
        }
      });

      it('Accepted: a Retrieve the server would refuse (a report is past Pending) is hidden with the reason', async () => {
        const s = await actionsOf(
          { status: SampleStatus.ACCEPTED },
          { retrieveRefused: true },
        );
        expect(s.actions).not.toContain('Retrieve');
        expect(s.hiddenActionReasons.Retrieve).toMatch(/Re-run/);
      });

      it('a button stays while ANY sample of the section would still be accepted (group actions skip invalid ones)', async () => {
        const w = world({
          samples: [sample({ id: 's1' }), sample({ id: 's2' })],
        });
        w.samples.reportBlocksFor.mockImplementation((_tx, _t, id: string) =>
          Promise.resolve({ repeat: id === 's1', dispatch: id === 's1' }),
        );
        w.samples.retrieveRefusedByStartedReport.mockImplementation(
          (_tx, _t, id: string) => Promise.resolve(id === 's1'),
        );
        const s = found(await w.search('IN_HOUSE')).sections[0]!;
        expect(s.actions).toEqual(
          expect.arrayContaining([
            'Repeat',
            'Send',
            'Forward',
            'Outsource',
            'Retrieve',
          ]),
        );
        expect(s.hiddenActionReasons.Repeat).toBeUndefined();
      });

      it('Acquired: Halt is offered (Acquired -> Halt is allowed) and Store / Return are not gated', async () => {
        const { search, samples } = world({
          samples: [sample({ status: SampleStatus.ACQUIRED })],
        });
        const s = found(await search('IN_HOUSE')).sections[0]!;
        expect(s.actions).toEqual([
          'Accept',
          'Repeat',
          'Halt',
          'Error',
          'Store',
          'Retrieve',
        ]);
        expect(samples.storeReturnGate).not.toHaveBeenCalled();
      });

      it('Repeat: Collect, Collect & Print, Hold, Cancel and Retrieve (the document row)', async () => {
        const s = await actionsOf({ status: SampleStatus.REPEAT });
        expect(s.actions).toEqual([
          'Collect',
          'Collect & Print',
          'Hold',
          'Cancel',
          'Retrieve',
        ]);
      });

      it.each([
        SampleStatus.SENT_INTERNAL,
        SampleStatus.FORWARD_EXTERNAL,
        SampleStatus.OUTSOURCED,
        SampleStatus.STORED,
        SampleStatus.CANCELLED,
      ])('%s: Retrieve only', async (status) => {
        expect((await actionsOf({ status })).actions).toEqual(['Retrieve']);
      });

      it('Discarded: Retrieve only when marked recoverable, with the flag button either way', async () => {
        const no = await actionsOf({
          status: SampleStatus.DISCARDED,
          isRecoverable: false,
        });
        expect(no.actions).toEqual(['Mark Recoverable']);
        expect(no.hiddenActionReasons.Retrieve).toBe('Not marked recoverable.');
        expect(no.flags.recoverable).toBe(false);
        const yes = await actionsOf({
          status: SampleStatus.DISCARDED,
          isRecoverable: true,
        });
        expect(yes.actions).toEqual(['Retrieve', 'Mark Not Recoverable']);
        expect(yes.flags.recoverable).toBe(true);
      });

      it('Returned: Retrieve only after the sample is verified', async () => {
        const no = await actionsOf({ status: SampleStatus.RETURNED });
        expect(no.actions).toEqual(['Mark Returned & Verified']);
        expect(no.flags.returnedVerified).toBe(false);
        const yes = await actionsOf({
          status: SampleStatus.RETURNED,
          returnedVerifiedAt: new Date(),
        });
        expect(yes.actions).toEqual(['Retrieve']);
        expect(yes.flags.returnedVerified).toBe(true);
      });

      describe('a section whose rows carry different flags (one barcode shared by tests of several departments)', () => {
        const sections = async (samples: ReturnType<typeof sample>[]) =>
          found(await world({ samples }).search('IN_HOUSE')).sections;

        it('Discarded, recoverable + not recoverable: Retrieve stays (for the recoverable row) and both flag buttons are offered', async () => {
          const [s] = await sections([
            sample({
              id: 'a',
              status: SampleStatus.DISCARDED,
              isRecoverable: true,
            }),
            sample({
              id: 'b',
              status: SampleStatus.DISCARDED,
              isRecoverable: false,
            }),
          ]);
          expect(s!.sampleIds).toEqual(['a', 'b']);
          expect(s!.actions).toEqual([
            'Retrieve',
            'Mark Recoverable',
            'Mark Not Recoverable',
          ]);
          expect(s!.hiddenActionReasons.Retrieve).toBeUndefined();
          expect(s!.flags).toMatchObject({
            recoverable: false, // "every row" is false...
            mixed: true, // ...but the rows differ
          });
          expect(s!.rows.map((r) => [r.sampleId, r.recoverable])).toEqual([
            ['a', true],
            ['b', false],
          ]);
        });

        it('Discarded, all not recoverable: only Mark Recoverable, Retrieve hidden (as before)', async () => {
          const [s] = await sections([
            sample({ id: 'a', status: SampleStatus.DISCARDED }),
            sample({
              id: 'b',
              status: SampleStatus.DISCARDED,
              isRecoverable: false,
            }),
          ]);
          expect(s!.actions).toEqual(['Mark Recoverable']);
          expect(s!.hiddenActionReasons.Retrieve).toBe(
            'Not marked recoverable.',
          );
          expect(s!.flags.mixed).toBe(false);
        });

        it('Discarded, all recoverable: Retrieve + Mark Not Recoverable (as before), not mixed', async () => {
          const [s] = await sections([
            sample({
              id: 'a',
              status: SampleStatus.DISCARDED,
              isRecoverable: true,
            }),
            sample({
              id: 'b',
              status: SampleStatus.DISCARDED,
              isRecoverable: true,
            }),
          ]);
          expect(s!.actions).toEqual(['Retrieve', 'Mark Not Recoverable']);
          expect(s!.flags.mixed).toBe(false);
        });

        it('Returned, verified + unverified: Retrieve stays and Mark Returned & Verified stays', async () => {
          const [s] = await sections([
            sample({
              id: 'a',
              status: SampleStatus.RETURNED,
              returnedVerifiedAt: new Date(),
            }),
            sample({ id: 'b', status: SampleStatus.RETURNED }),
          ]);
          expect(s!.actions).toEqual(['Retrieve', 'Mark Returned & Verified']);
          expect(s!.flags.mixed).toBe(true);
          expect(s!.rows.map((r) => [r.sampleId, r.returnedVerified])).toEqual([
            ['a', true],
            ['b', false],
          ]);
        });

        it('Returned, all verified: Retrieve only; none verified: the button only', async () => {
          const [all] = await sections([
            sample({
              id: 'a',
              status: SampleStatus.RETURNED,
              returnedVerifiedAt: new Date(),
            }),
            sample({
              id: 'b',
              status: SampleStatus.RETURNED,
              returnedVerifiedAt: new Date(),
            }),
          ]);
          expect(all!.actions).toEqual(['Retrieve']);
          expect(all!.flags.mixed).toBe(false);
          const [none] = await sections([
            sample({ id: 'a', status: SampleStatus.RETURNED }),
            sample({ id: 'b', status: SampleStatus.RETURNED }),
          ]);
          expect(none!.actions).toEqual(['Mark Returned & Verified']);
          expect(none!.flags.mixed).toBe(false);
        });

        it('a row in any other status carries no per-row flag', async () => {
          const [s] = await sections([sample({ id: 'a' })]);
          expect(s!.rows[0]).toMatchObject({
            recoverable: null,
            returnedVerified: null,
          });
          expect(s!.flags.mixed).toBe(false);
        });
      });

      it('a cancelled order keeps only the wind-down (Retrieve of a tube that is out, Store of a received copy)', async () => {
        expect(
          (
            await actionsOf({
              status: SampleStatus.ACCEPTED,
              orderStatus: 'CANCELLED',
            })
          ).actions,
        ).toEqual([]);
        expect(
          (
            await actionsOf({
              status: SampleStatus.SENT_INTERNAL,
              orderStatus: 'CANCELLED',
            })
          ).actions,
        ).toEqual(['Retrieve']);
        expect(
          (
            await actionsOf({
              status: SampleStatus.ACCEPTED,
              orderStatus: 'CANCELLED',
              sourceTransferId: 'tr1',
            })
          ).actions,
        ).toEqual(['Store']);
      });

      it('a removed test keeps only Store', async () => {
        const s = await actionsOf({
          status: SampleStatus.ACCEPTED,
          itemRemoved: true,
        });
        expect(s.actions).toEqual(['Store']);
        expect(s.itemRemoved).toBe(true);
      });

      it('a removed test does not take the buttons away from the other tests of the barcode', async () => {
        const r = found(
          await world({
            samples: [
              sample({ id: 's1', status: SampleStatus.ACCEPTED }),
              sample({
                id: 's2',
                status: SampleStatus.ACCEPTED,
                itemRemoved: true,
              }),
              sample({ id: 's3', status: SampleStatus.ACCEPTED }),
            ],
          }).search('IN_HOUSE'),
        );
        // two sections of the same status: the live rows keep every button, the removed one only Store
        expect(
          r.sections.map((s) => [s.itemRemoved, s.rows.length, s.actions]),
        ).toEqual([
          [
            false,
            2,
            [
              'Store',
              'Repeat',
              'Return',
              'Send',
              'Forward',
              'Outsource',
              'Retrieve',
            ],
          ],
          [true, 1, ['Store']],
        ]);
      });
    });
  });

  describe('Referral menus', () => {
    const transfer = (over: Record<string, unknown> = {}) => ({
      id: 'tr1',
      kind: TransferKind.INTERNAL,
      transferStatus: TransferStatus.RECEIVED,
      sampleId: 's1',
      originBranchId: 'b2',
      destinationBranchId: 'b1',
      outsourceCenterId: null,
      externalPartnerName: null,
      sendDate: new Date('2026-11-12T00:00:00Z'),
      sendTime: '12:32',
      createdAt: new Date(),
      sample: sample(),
      ...over,
    });

    it('Internal: transfers coming to this branch, without those hidden from the receiver', async () => {
      const { tx, search } = world({ referral: [transfer()] });
      await search('INTERNAL');
      const args = (
        tx.sampleTransfer.findMany.mock.calls[0] as [
          { where: Record<string, unknown> },
        ]
      )[0];
      expect(args.where).toMatchObject({
        tenantId: 't1',
        kind: 'INTERNAL',
        destinationBranchId: 'b1',
        // the sample carries the barcode, or it waits for a new tube because a Repeat took this barcode off it
        sample: {
          is: {
            deletedAt: null,
            OR: [
              { barcode: { equals: '10050', mode: 'insensitive' } },
              {
                barcode: null,
                barcodeBeforeRepeat: { equals: '10050', mode: 'insensitive' },
              },
            ],
          },
        },
      });
      expect(args.where).toHaveProperty('NOT');
    });

    it('External: transfers going out of this branch', async () => {
      const { tx, search } = world({
        referral: [transfer({ kind: TransferKind.EXTERNAL })],
      });
      await search('EXTERNAL');
      const args = (
        tx.sampleTransfer.findMany.mock.calls[0] as [
          { where: Record<string, unknown> },
        ]
      )[0];
      expect(args.where).toMatchObject({
        kind: 'EXTERNAL',
        originBranchId: 'b1',
      });
    });

    it.each([
      [TransferStatus.IN_TRANSIT, ['Picked Up']],
      [TransferStatus.PICKED_UP, ['Receive', 'Retrieve']],
      [TransferStatus.RECEIVED, ['Accept', 'Reject', 'Retrieve']],
      [TransferStatus.ACCEPTED, ['Repeat', 'Retrieve']],
      [TransferStatus.REPEAT, ['Retrieve']],
      [TransferStatus.REJECTED, ['Retrieve']],
    ])("%s: the document's buttons", async (status, expected) => {
      const r = found(
        await world({
          referral: [
            transfer({
              transferStatus: status,
              // the sender's sample is Sent while its transfer is open (also after the receiver sent it back)
              sample: sample({ status: SampleStatus.SENT_INTERNAL }),
            }),
          ],
        }).search('INTERNAL'),
      );
      expect(r.sections[0]!.actions).toEqual(expected);
      expect(r.sections[0]!.kind).toBe('TRANSFER');
    });

    describe('a Repeat the sender has already confirmed', () => {
      const repeated = (senderSample: SampleStatus, over = {}) =>
        transfer({
          transferStatus: TransferStatus.REPEAT,
          sample: sample({ status: senderSample }),
          ...over,
        });

      it('the receiver can no longer Retrieve it (the sender sample left Sent), and the reason is given', async () => {
        const r = found(
          await world({
            referral: [repeated(SampleStatus.REPEAT)],
          }).search('INTERNAL'),
        );
        expect(r.sections[0]!.actions).toEqual([]);
        expect(r.sections[0]!.hiddenActionReasons.Retrieve).toMatch(
          /already confirmed/,
        );
      });

      it('the same for a Reject the sender has flagged as Error', async () => {
        const rejected = (senderSample: SampleStatus) =>
          transfer({
            transferStatus: TransferStatus.REJECTED,
            sample: sample({ status: senderSample }),
          });
        const gone = found(
          await world({ referral: [rejected(SampleStatus.ERROR)] }).search(
            'INTERNAL',
          ),
        );
        expect(gone.sections[0]!.actions).toEqual([]);
        expect(gone.sections[0]!.hiddenActionReasons.Retrieve).toMatch(
          /flagged the rejected sample as Error/,
        );
        const kept = found(
          await world({
            referral: [rejected(SampleStatus.SENT_INTERNAL)],
          }).search('INTERNAL'),
        );
        expect(kept.sections[0]!.actions).toEqual(['Retrieve']);
      });

      it('before the sender confirms (its sample is still Sent) Retrieve stays', async () => {
        const r = found(
          await world({
            referral: [repeated(SampleStatus.SENT_INTERNAL)],
          }).search('INTERNAL'),
        );
        expect(r.sections[0]!.actions).toEqual(['Retrieve']);
        expect(r.sections[0]!.hiddenActionReasons.Retrieve).toBeUndefined();
      });

      it('a group keeps the button while ANY transfer of it can still be retrieved (group actions skip the others)', async () => {
        const r = found(
          await world({
            referral: [
              repeated(SampleStatus.REPEAT, {
                id: 'tr1',
                sampleId: 's1',
                sample: sample({ id: 's1', status: SampleStatus.REPEAT }),
              }),
              repeated(SampleStatus.SENT_INTERNAL, {
                id: 'tr2',
                sampleId: 's2',
                sample: sample({
                  id: 's2',
                  status: SampleStatus.SENT_INTERNAL,
                }),
              }),
            ],
          }).search('INTERNAL'),
        );
        expect(r.sections[0]!.actions).toEqual(['Retrieve']);
      });

      it('an External transfer is retrieved by its sender, whose sample is never Sent: the button stays', async () => {
        const r = found(
          await world({
            referral: [
              repeated(SampleStatus.FORWARD_EXTERNAL, {
                kind: TransferKind.EXTERNAL,
              }),
            ],
          }).search('EXTERNAL'),
        );
        expect(r.sections[0]!.actions).toEqual(['Retrieve']);
      });
    });

    it('In-House fields: RM Branch is the origin branch, Processing Branch is hidden, no sent date', async () => {
      const own = found(
        await world({ samples: [sample()] }).search('IN_HOUSE'),
      );
      expect(own.fields).toMatchObject({
        originBranch: 'Main',
        processingBranch: null,
        sent: { date: null },
      });
      // a copy received from another branch: the RM Branch is the branch it came from, not the one processing it
      const copy = found(
        await world({ samples: [sample({ originBranchId: 'b2' })] }).search(
          'IN_HOUSE',
        ),
      );
      expect(copy.fields).toMatchObject({
        originBranch: 'Other',
        processingBranch: null,
      });
    });

    it('Internal fields: the sending branch, the receiving branch (processing) and the sent date', async () => {
      const r = found(
        await world({ referral: [transfer()] }).search('INTERNAL'),
      );
      expect(r.fields).toMatchObject({
        originBranch: 'Other',
        processingBranch: 'Main',
        externalPartner: null,
        sent: { time: '12:32' },
        forwarded: { date: null },
      });
    });

    it('External fields: no processing branch, the partner name, the forward date', async () => {
      const r = found(
        await world({
          referral: [
            transfer({
              kind: TransferKind.EXTERNAL,
              destinationBranchId: null,
              originBranchId: 'b1',
              externalPartnerName: 'Pathkind',
            }),
          ],
        }).search('EXTERNAL'),
      );
      expect(r.fields).toMatchObject({
        originBranch: 'Main',
        processingBranch: null,
        externalPartner: 'Pathkind',
        forwarded: { time: '12:32' },
        sent: { date: null },
      });
    });

    it('a cancelled order keeps only the send-back of a Received transfer', async () => {
      const cancelled = sample({ orderStatus: 'CANCELLED' });
      const received = found(
        await world({ referral: [transfer({ sample: cancelled })] }).search(
          'INTERNAL',
        ),
      );
      expect(received.sections[0]!.actions).toEqual(['Reject']);
      const accepted = found(
        await world({
          referral: [
            transfer({
              sample: cancelled,
              transferStatus: TransferStatus.ACCEPTED,
            }),
          ],
        }).search('INTERNAL'),
      );
      expect(accepted.sections[0]!.actions).toEqual([]);
    });
  });
});
