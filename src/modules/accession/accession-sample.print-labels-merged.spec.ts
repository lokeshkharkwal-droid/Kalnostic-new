import { EventEmitter2 } from '@nestjs/event-emitter';
import { AccessionSettingsService } from './accession-settings.service';
import { OrderSampleService } from './accession-sample.service';
import { LabReportService } from '../lab-report/lab-report.service';
import { PdfReportTemplateService } from '../pdf-report-template/pdf-report-template.service';
import { PdfTemplateConfigService } from '../pdf-report-template/pdf-template-config.service';
import { GeneratePdfDto } from '../pdf-report-template/dto/generate-pdf.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantService } from '../tenant/tenant.service';
import { BarcodeService } from './barcode.service';
import { UserDepartmentScopeService } from '../department/user-department-scope.service';
import { AppointmentService } from '../appointment/appointment.service';
import { OrderSampleDetail } from './entities/accession-sample.entity';

/**
 * One barcode can cover several tests whose container, sample type, sample name and department differ (Order and
 * Department grouping modes). The merged label (`printLabels` → `buildMergedLabelVariables`) used to print those four
 * fields from the FIRST sample only; it now lists every distinct value. A single-sample label is unchanged.
 */
describe('OrderSampleService — printLabels merged label (one barcode, several samples)', () => {
  const tenantService = { getLocale: jest.fn() };
  const pdfReportTemplateService = { generatePdf: jest.fn() };
  let service: OrderSampleService;

  const sample = (
    id: string,
    over: Partial<Record<string, unknown>> = {},
  ): OrderSampleDetail =>
    ({
      id,
      accessionNo: `ACC-${id}`,
      barcode: 'BC-1',
      orderIdBarcode: 'https://img/BC-1',
      sampleName: null,
      sampleType: null,
      containerType: null,
      priority: 'ROUTINE',
      collectedAt: null,
      departmentLabel: null,
      tests: [{ testName: `Test ${id}` }],
      order: { orderCode: 'ORD-1', patient: null },
      ...over,
    }) as unknown as OrderSampleDetail;

  const samples: Record<string, OrderSampleDetail> = {
    urine: sample('urine', {
      sampleName: 'Urine',
      sampleType: 'Urine',
      containerType: 'URINE_CONTAINER',
      departmentLabel: 'Biochemistry',
    }),
    bun: sample('bun', {
      sampleName: 'Fluid',
      sampleType: 'Fluid',
      containerType: null,
      departmentLabel: 'Biochemistry',
    }),
    hb: sample('hb', {
      sampleName: 'Whole blood',
      sampleType: 'Blood',
      containerType: 'PLAIN_TUBE_RED_TOP',
      departmentLabel: 'Haematology, Biochemistry',
    }),
    hb2: sample('hb2', {
      sampleName: 'Whole blood',
      sampleType: 'Blood',
      containerType: 'PLAIN_TUBE_RED_TOP',
      departmentLabel: null,
    }),
    solo: sample('solo', {
      barcode: 'BC-2',
      sampleName: 'Serum',
      sampleType: 'Serum',
      containerType: 'PLAIN_TUBE_RED_TOP',
      departmentLabel: 'Biochemistry',
    }),
  };

  const printed = (): Array<Record<string, unknown>> => {
    const calls = pdfReportTemplateService.generatePdf.mock.calls as Array<
      [string, string, GeneratePdfDto]
    >;
    return calls[calls.length - 1]![2].sections?.labels ?? [];
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new OrderSampleService(
      {} as unknown as PrismaService,
      {} as unknown as AccessionSettingsService,
      {} as unknown as LabReportService,
      pdfReportTemplateService as unknown as PdfReportTemplateService,
      {} as unknown as PdfTemplateConfigService,
      {} as unknown as EventEmitter2,
      tenantService as unknown as TenantService,
      {} as unknown as BarcodeService,
      {} as unknown as UserDepartmentScopeService,
      {} as unknown as AppointmentService,
    );
    jest
      .spyOn(service, 'findById')
      .mockImplementation((id: string) => Promise.resolve(samples[id]!));
    pdfReportTemplateService.generatePdf.mockResolvedValue(Buffer.from(''));
    tenantService.getLocale.mockResolvedValue({
      timezone: 'Asia/Kolkata',
      dateFormat: 'DD/MM/YYYY',
      timeFormat: '12h',
    });
  });

  it('lists every distinct sample type, container, sample name and department of the group, not only the first row', async () => {
    await service.printLabels(['urine', 'bun', 'hb'], 't1', null, 'tpl-1');

    const labels = printed();
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({
      sample_type: 'Urine, Fluid, Blood',
      sample_name: 'Urine, Fluid, Whole blood',
      // The row with no container adds nothing; the others show their readable container names.
      container_type: 'Urine Container, Plain Tube (Red)',
      // A row's own department list is split first, so no value is repeated.
      department_name: 'Biochemistry, Haematology',
    });
    expect(labels[0]!.test_names).toBe('Test urine, Test bun, Test hb');
  });

  it('does not repeat a value the rows share', async () => {
    await service.printLabels(['hb', 'hb2'], 't1', null, 'tpl-1');

    expect(printed()[0]).toMatchObject({
      sample_type: 'Blood',
      sample_name: 'Whole blood',
    });
  });

  it('leaves a single-sample label exactly as before', async () => {
    await service.printLabels(['solo'], 't1', null, 'tpl-1');

    expect(printed()[0]).toMatchObject({
      sample_type: 'Serum',
      sample_name: 'Serum',
      department_name: 'Biochemistry',
    });
  });
});
