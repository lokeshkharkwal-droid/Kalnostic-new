import { EventEmitter2 } from '@nestjs/event-emitter';
import { AccessionSettingsService } from './accession-settings.service';
import { OrderSampleService } from './accession-sample.service';
import { LabReportService } from '../lab-report/lab-report.service';
import { PdfReportTemplateService } from '../pdf-report-template/pdf-report-template.service';
import { TemplateRenderService } from '../pdf-report-template/services/template-render.service';
import { PdfTemplateMeta } from '../pdf-report-template/constants/pdf-template-meta.constant';
import { GeneratePdfDto } from '../pdf-report-template/dto/generate-pdf.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantService } from '../tenant/tenant.service';
import { BarcodeService } from './barcode.service';
import { UserDepartmentScopeService } from '../department/user-department-scope.service';
import { OrderSampleDetail } from './entities/accession-sample.entity';

/**
 * `{collected_at}` on a Multiple Order Label Print (`printLabels` →
 * `multiple_order_label_print`): every `sections.labels` row carries its OWN
 * sample's collection date AND time (tenant timezone, date format and 12h/24h
 * time), and is blank for a sample that isn't collected yet.
 */
describe('OrderSampleService — printLabels {collected_at}', () => {
  const tenantService = { getLocale: jest.fn() };
  const pdfReportTemplateService = { generatePdf: jest.fn() };
  let service: OrderSampleService;

  /** A composed sample with just the fields `buildLabelVariables` reads. */
  const sample = (
    id: string,
    orderCode: string,
    collectedAt: string | null,
  ): OrderSampleDetail =>
    ({
      id,
      accessionNo: `ACC-${id}`,
      barcode: null,
      orderIdBarcode: null,
      sampleType: 'Blood',
      containerType: null,
      priority: 'ROUTINE',
      collectedAt: collectedAt ? new Date(collectedAt) : null,
      departmentLabel: null,
      tests: [],
      order: { orderCode, patient: null },
    }) as unknown as OrderSampleDetail;

  const samples: Record<string, OrderSampleDetail> = {
    s1: sample('s1', 'ORD-00115', '2026-09-18T10:05:39.774Z'),
    s2: sample('s2', 'ORD-00114', '2026-09-10T05:48:29.430Z'),
    s3: sample('s3', 'ORD-00118', null),
  };

  /** The render context `printLabels` handed to `generatePdf`. */
  const printedContext = (): GeneratePdfDto => {
    const calls = pdfReportTemplateService.generatePdf.mock.calls as Array<
      [string, string, GeneratePdfDto]
    >;
    return calls[calls.length - 1]![2];
  };

  /** `collected_at` of each printed label, in print order. */
  const printedCollectedAt = (): unknown[] =>
    (printedContext().sections?.labels ?? []).map((l) => l.collected_at);

  beforeEach(() => {
    jest.clearAllMocks();
    service = new OrderSampleService(
      {} as unknown as PrismaService,
      {} as unknown as AccessionSettingsService,
      {} as unknown as LabReportService,
      pdfReportTemplateService as unknown as PdfReportTemplateService,
      {} as unknown as EventEmitter2,
      tenantService as unknown as TenantService,
      {} as unknown as BarcodeService,
      {} as unknown as UserDepartmentScopeService,
    );
    jest
      .spyOn(service, 'findById')
      .mockImplementation((id: string) => Promise.resolve(samples[id]!));
    pdfReportTemplateService.generatePdf.mockResolvedValue(Buffer.from(''));
  });

  const locale = (timeFormat: string) =>
    tenantService.getLocale.mockResolvedValue({
      timezone: 'Asia/Kolkata',
      dateFormat: 'DD/MM/YYYY',
      timeFormat,
    });

  it("prints each label's own collection date and time (12h)", async () => {
    locale('12h');

    await service.printLabels(['s1', 's2', 's3'], 't1', 'tpl-1');

    expect(printedCollectedAt()).toEqual([
      '18/09/2026 3:35 PM',
      '10/09/2026 11:18 AM',
      '',
    ]);
    expect(pdfReportTemplateService.generatePdf).toHaveBeenCalledWith(
      'tpl-1',
      't1',
      expect.any(Object),
    );
  });

  it("follows the tenant's 24h time format", async () => {
    locale('24h');

    await service.printLabels(['s2', 's1'], 't1', 'tpl-1');

    expect(printedCollectedAt()).toEqual([
      '10/09/2026 11:18',
      '18/09/2026 15:35',
    ]);
  });

  it('resolves {collected_at} per label inside {{#each labels}}', async () => {
    locale('12h');

    await service.printLabels(['s1', 's3', 's2'], 't1', 'tpl-1');

    const meta = {
      header_html: '',
      footer_html: '',
      body_html:
        '{{#each labels}}[{order_code} collected {collected_at}]{{/each}}',
    } as unknown as PdfTemplateMeta;
    const { bodyHtml } = new TemplateRenderService().render(
      meta,
      printedContext(),
    );

    expect(bodyHtml).toContain(
      '[ORD-00115 collected 18/09/2026 3:35 PM]' +
        '[ORD-00118 collected ]' +
        '[ORD-00114 collected 10/09/2026 11:18 AM]',
    );
  });
});
