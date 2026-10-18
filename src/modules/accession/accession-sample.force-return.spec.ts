import { EventEmitter2 } from '@nestjs/event-emitter';
import { SampleStatus } from '@prisma/client';
import { AccessionSettingsService } from './accession-settings.service';
import { OrderSampleService } from './accession-sample.service';
import { InvalidSampleTransitionException } from './exceptions/accession.exceptions';
import { LabReportService } from '../lab-report/lab-report.service';
import { PdfReportTemplateService } from '../pdf-report-template/pdf-report-template.service';
import { PdfTemplateConfigService } from '../pdf-report-template/pdf-template-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantService } from '../tenant/tenant.service';
import { BarcodeService } from './barcode.service';
import { UserDepartmentScopeService } from '../department/user-department-scope.service';

/**
 * A group "Return" is sent with `force: true` (group actions override the
 * sample's current status). Return must NOT be forceable: a sample can only be
 * returned from a status where `SAMPLE_TRANSITIONS.return` allows it (Accepted,
 * Acquired, Halt, Error, Stored). Before this was fixed, a mixed-status group
 * (e.g. one Collected + one Accepted sample) forced the Collected sample straight
 * to Returned.
 */
describe('OrderSampleService — forced Return respects the allowed statuses', () => {
  const samples = new Map<string, { id: string; status: SampleStatus }>();

  const tx = {
    order: { findFirst: jest.fn().mockResolvedValue(null) },
    orderSample: {
      // No receiving-branch copies in these groups (returnSample looks them up first).
      findMany: jest.fn().mockResolvedValue([]),
      // The row claim transitionInTx takes before it moves a sample.
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirst: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(samples.get(where.id) ?? null),
      ),
      update: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: string };
          data: { status: SampleStatus };
        }) => Promise.resolve({ id: where.id, status: data.status }),
      ),
    },
    orderSampleStatusHistory: { create: jest.fn().mockResolvedValue({}) },
    // the "test removed from the order" probe: no removed test
    orderSampleTest: { findMany: jest.fn().mockResolvedValue([]) },
  };

  const prisma = {
    withTenant: jest.fn((_tenantId: string, cb: (t: typeof tx) => unknown) =>
      cb(tx),
    ),
  };

  let service: OrderSampleService;

  const addSample = (id: string, status: SampleStatus) =>
    samples.set(id, { id, status });

  beforeEach(() => {
    jest.clearAllMocks();
    samples.clear();
    service = new OrderSampleService(
      prisma as unknown as PrismaService,
      {} as unknown as AccessionSettingsService,
      {} as unknown as LabReportService,
      {} as unknown as PdfReportTemplateService,
      {} as unknown as PdfTemplateConfigService,
      {} as unknown as EventEmitter2,
      {} as unknown as TenantService,
      {} as unknown as BarcodeService,
      {} as unknown as UserDepartmentScopeService,
    );
    // The final re-read of the changed samples is not under test.
    jest
      .spyOn(service, 'findById')
      .mockImplementation((id: string) => Promise.resolve({ id }) as never);
  });

  /** A forced bulk Return, exactly what the group "Return" action sends. */
  const forcedReturn = (ids: string[], skipInvalid = false) =>
    service.returnSample(ids, 't1', 'p1', {
      force: true,
      ...(skipInvalid ? { skipInvalid: true } : {}),
    } as never);

  const updatedIds = () =>
    tx.orderSample.update.mock.calls.map(
      ([arg]) => (arg as { where: { id: string } }).where.id,
    );

  it.each([
    SampleStatus.NEW,
    SampleStatus.COLLECTED,
    SampleStatus.HOLD,
    SampleStatus.REPEAT,
  ])(
    'refuses a forced Return of a %s sample and changes nothing',
    async (status) => {
      addSample('s1', status);

      await expect(forcedReturn(['s1'])).rejects.toBeInstanceOf(
        InvalidSampleTransitionException,
      );
      expect(tx.orderSample.update).not.toHaveBeenCalled();
      expect(tx.orderSampleStatusHistory.create).not.toHaveBeenCalled();
    },
  );

  it.each([
    SampleStatus.ACCEPTED,
    SampleStatus.ACQUIRED,
    SampleStatus.HALT,
    SampleStatus.ERROR,
    SampleStatus.STORED,
  ])('still returns a %s sample when Return is forced', async (status) => {
    addSample('s1', status);

    await forcedReturn(['s1']);

    expect(tx.orderSample.update).toHaveBeenCalledTimes(1);
    expect(tx.orderSample.update.mock.calls[0]![0]).toMatchObject({
      where: { id: 's1' },
      data: { status: SampleStatus.RETURNED, previousStatus: status },
    });
  });

  it('a mixed group with skipInvalid returns only the samples that are allowed', async () => {
    addSample('collected', SampleStatus.COLLECTED);
    addSample('accepted', SampleStatus.ACCEPTED);
    addSample('new', SampleStatus.NEW);
    addSample('stored', SampleStatus.STORED);

    await forcedReturn(['collected', 'accepted', 'new', 'stored'], true);

    expect(updatedIds()).toEqual(['accepted', 'stored']);
  });

  it('a mixed group WITHOUT skipInvalid is refused as a whole (never silently returns the Collected sample)', async () => {
    addSample('collected', SampleStatus.COLLECTED);
    addSample('accepted', SampleStatus.ACCEPTED);

    await expect(
      forcedReturn(['accepted', 'collected']),
    ).rejects.toBeInstanceOf(InvalidSampleTransitionException);
    expect(updatedIds()).not.toContain('collected');
  });

  it('other forced group actions are unchanged (Accept still forces a Hold sample)', async () => {
    addSample('s1', SampleStatus.HOLD);

    await service.transitionInTx(
      tx as never,
      't1',
      'p1',
      's1',
      'accept',
      () => ({ data: {} }),
      { force: true },
    );

    expect(tx.orderSample.update.mock.calls[0]![0]).toMatchObject({
      data: { status: SampleStatus.ACCEPTED },
    });
  });
});
