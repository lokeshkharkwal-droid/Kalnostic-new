import { EventEmitter2 } from '@nestjs/event-emitter';
import { AccessionSettingsService } from './accession-settings.service';
import { OrderSampleService } from './accession-sample.service';
import { LabReportService } from '../lab-report/lab-report.service';
import { PdfReportTemplateService } from '../pdf-report-template/pdf-report-template.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantService } from '../tenant/tenant.service';
import { BarcodeService } from './barcode.service';
import { UserDepartmentScopeService } from '../department/user-department-scope.service';

/**
 * `sample_name` is snapshotted onto each `OrderSample` when it is generated, so
 * the label / report print can show it even after the test's sample config is
 * edited or re-imported (which replaces the `LabTestSample` rows).
 */
describe('OrderSampleService — generateForOrderInTx sample name', () => {
  const buildService = () =>
    new OrderSampleService(
      {} as unknown as PrismaService,
      {} as unknown as AccessionSettingsService,
      {} as unknown as LabReportService,
      {} as unknown as PdfReportTemplateService,
      {} as unknown as EventEmitter2,
      {} as unknown as TenantService,
      {} as unknown as BarcodeService,
      {} as unknown as UserDepartmentScopeService,
    );

  /** A tx whose order has one test requiring the given live sample rows. */
  const txFor = (liveSamples: unknown[]) => ({
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
          },
        },
      ]),
    },
    labTestSample: { findMany: jest.fn().mockResolvedValue(liveSamples) },
    tenant: {
      update: jest.fn().mockResolvedValue({ accessionCounter: 7 }),
    },
  });

  const generate = (tx: ReturnType<typeof txFor>) =>
    buildService().generateForOrderInTx(
      tx as never,
      't1',
      'b1',
      'p1',
      'order-1',
    );

  const createdData = (tx: ReturnType<typeof txFor>) =>
    (
      tx.orderSample.create.mock.calls as unknown as Array<
        [{ data: Record<string, unknown> }]
      >
    )[0]![0].data;

  it("copies the test sample's name onto the new OrderSample", async () => {
    const tx = txFor([
      {
        id: 'lts-1',
        sampleName: 'Fasting blood',
        sampleType: 'Blood',
        containerType: 'EDTA_TUBE_PURPLE_TOP',
      },
    ]);

    await generate(tx);

    expect(tx.orderSample.create).toHaveBeenCalledTimes(1);
    expect(createdData(tx)).toMatchObject({
      accessionNo: 'ACC-00007',
      labTestSampleId: 'lts-1',
      sampleName: 'Fasting blood',
      sampleType: 'Blood',
      sampleGroupLabel: 'Fasting blood',
    });
  });

  it('stores a null name (and groups by type) when the sample has no name', async () => {
    const tx = txFor([
      {
        id: 'lts-2',
        sampleName: null,
        sampleType: 'Serum',
        containerType: 'PLAIN_TUBE_RED_TOP',
      },
    ]);

    await generate(tx);

    expect(createdData(tx)).toMatchObject({
      sampleName: null,
      sampleType: 'Serum',
      sampleGroupLabel: 'Serum',
    });
  });
});
