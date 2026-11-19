import { EventEmitter2 } from '@nestjs/event-emitter';
import { AccessionSettingsService } from './accession-settings.service';
import { OrderSampleService } from './accession-sample.service';
import { LabReportService } from '../lab-report/lab-report.service';
import { PdfReportTemplateService } from '../pdf-report-template/pdf-report-template.service';
import { PdfTemplateConfigService } from '../pdf-report-template/pdf-template-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantService } from '../tenant/tenant.service';
import { BarcodeService } from './barcode.service';
import { UserDepartmentScopeService } from '../department/user-department-scope.service';
import { AppointmentService } from '../appointment/appointment.service';

/**
 * A "Sample Flow = No" sample is collected and accepted by the system at order creation. Its generate / collect / accept
 * history lines are written in ONE statement, so without their own times they carried the same instant to the microsecond
 * and were stored in random order (Accept before Collect on the History popup; a Retrieve that could loop). They are now
 * stamped one millisecond apart, in the order they happen.
 */
describe('OrderSampleService.generateForOrderInTx - history lines of an auto-accepted sample', () => {
  const build = () => {
    const service = new OrderSampleService(
      {} as unknown as PrismaService,
      {} as unknown as AccessionSettingsService,
      {} as unknown as LabReportService,
      {} as unknown as PdfReportTemplateService,
      {} as unknown as PdfTemplateConfigService,
      {} as unknown as EventEmitter2,
      {} as unknown as TenantService,
      {} as unknown as BarcodeService,
      {} as unknown as UserDepartmentScopeService,
      {} as unknown as AppointmentService,
    );
    // the report creation and the barcode step are not what is tested here
    jest
      .spyOn(service as never, 'ensureLabReportsForAcceptedSample')
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(service as never, 'assignBarcodesOnCollectInTx')
      .mockResolvedValue(undefined as never);
    return service;
  };

  const txFor = (isSampleFlow: boolean) => ({
    orderSample: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({ id: 'os-new' }),
    },
    orderItem: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'item-1',
          branchLabPanel: null,
          branchLabTest: {
            testName: 'Glucose',
            departmentId: 'dep-1',
            sourceLabTestId: 'src-glu',
            configSnapshot: {},
            isSampleFlow,
            isBillOnlyTest: false,
          },
        },
      ]),
    },
    labTestSample: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'lts-1',
          sampleName: 'Serum',
          sampleType: 'Blood',
          containerType: 'PLAIN_TUBE_RED_TOP',
        },
      ]),
    },
    // The order already carries its grouping mode (decided when it first got samples).
    order: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { id: 'order-1', groupingMode: 'DEPARTMENT_SAMPLE_NAME' },
        ]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    tenant: { update: jest.fn().mockResolvedValue({ accessionCounter: 7 }) },
  });

  const lines = async (isSampleFlow: boolean) => {
    const tx = txFor(isSampleFlow);
    await build().generateForOrderInTx(
      tx as never,
      't1',
      'b1',
      'p1',
      'order-1',
    );
    const data = (
      tx.orderSample.create.mock.calls as unknown as Array<
        [
          {
            data: {
              statusHistory: {
                create: Array<{ action: string; createdAt?: Date }>;
              };
            };
          },
        ]
      >
    )[0]![0].data;
    return data.statusHistory.create;
  };

  it('Sample Flow = No: generate, collect, accept, each with its OWN time, one millisecond apart and in that order', async () => {
    const rows = await lines(false);
    expect(rows.map((r) => r.action)).toEqual([
      'generate',
      'collect',
      'accept',
    ]);
    const times = rows.map((r) => r.createdAt!.getTime());
    expect(times.every((t) => Number.isFinite(t))).toBe(true);
    expect(times[1]! - times[0]!).toBe(1);
    expect(times[2]! - times[1]!).toBe(1);
  });

  it('Sample Flow = Yes: a single generate line (nothing to order)', async () => {
    const rows = await lines(true);
    expect(rows.map((r) => r.action)).toEqual(['generate']);
  });

  describe("the order's grouping mode is decided when it first gets samples", () => {
    it('an order with no mode takes the tenant mode (read under the tenant lock) BEFORE its first sample is created', async () => {
      const tx = txFor(true);
      tx.order.findMany
        .mockResolvedValueOnce([{ id: 'order-1', groupingMode: null }]) // before: undecided
        .mockResolvedValueOnce([{ id: 'order-1', groupingMode: 'ORDER' }]); // re-read after the conditional update
      tx.tenant.update.mockResolvedValue({
        accessionCounter: 7,
        groupingMode: 'ORDER',
      });
      await build().generateForOrderInTx(
        tx as never,
        't1',
        'b1',
        'p1',
        'order-1',
      );
      expect(tx.order.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['order-1'] }, tenantId: 't1', groupingMode: null },
        data: { groupingMode: 'ORDER' },
      });
      expect(tx.order.updateMany.mock.invocationCallOrder[0]!).toBeLessThan(
        tx.orderSample.create.mock.invocationCallOrder[0]!,
      );
    });

    it('an order that already has a mode keeps it (items added later never change it)', async () => {
      const tx = txFor(true); // the mock order is already decided
      await build().generateForOrderInTx(
        tx as never,
        't1',
        'b1',
        'p1',
        'order-1',
      );
      expect(tx.order.updateMany).not.toHaveBeenCalled();
    });
  });
});
