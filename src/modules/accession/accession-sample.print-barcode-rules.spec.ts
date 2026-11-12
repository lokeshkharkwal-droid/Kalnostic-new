import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrderSampleService } from './accession-sample.service';
import type { OrderSampleDetail } from './entities/accession-sample.entity';
import {
  BarcodeImageUnavailableException,
  NoBarcodeToPrintException,
} from './exceptions/accession.exceptions';
import { AccessionSettingsService } from './accession-settings.service';
import { BarcodeService } from './barcode.service';
import { LabReportService } from '../lab-report/lab-report.service';
import { PdfReportTemplateService } from '../pdf-report-template/pdf-report-template.service';
import { PdfTemplateConfigService } from '../pdf-report-template/pdf-template-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantService } from '../tenant/tenant.service';
import { UserDepartmentScopeService } from '../department/user-department-scope.service';
import { AppointmentService } from '../appointment/appointment.service';

/**
 * Printing labels:
 *  - a sample with no barcode (waiting to be collected again) has no label: it is left out and the caller is told how many;
 *    when nothing is left the print is refused with a clear message (never a blank label);
 *  - a sample with a barcode but no barcode PICTURE (e.g. restored while the file storage was down) gets its picture made at
 *    print time, once per barcode; if the storage is still down the print is refused with a clear message.
 */
const sample = (id: string, barcode: string | null, image: string | null): OrderSampleDetail =>
  ({
    id,
    accessionNo: `ACC-${id}`,
    barcode,
    orderIdBarcode: image,
    sampleName: null,
    sampleType: 'Blood',
    containerType: null,
    priority: 'ROUTINE',
    collectedAt: null,
    departmentLabel: null,
    tests: [],
    order: { orderCode: `ORD-${id}`, patient: null },
  }) as unknown as OrderSampleDetail;

function build(samples: Record<string, OrderSampleDetail>, storageUp = true) {
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  const prisma = {
    withTenant: (_t: string, fn: (tx: unknown) => unknown) =>
      fn({ orderSample: { updateMany } }),
  };
  const barcodes = {
    generateAndUpload: storageUp
      ? jest.fn().mockImplementation((v: string) => Promise.resolve(`https://img/${v}`))
      : jest.fn().mockRejectedValue(new Error('storage down')),
  };
  const pdf = { generatePdf: jest.fn().mockResolvedValue(Buffer.from('pdf')) };
  const tenants = {
    getLocale: jest.fn().mockResolvedValue({ timezone: 'Asia/Kolkata', dateFormat: 'DD/MM/YYYY', timeFormat: '12h' }),
  };
  const service = new OrderSampleService(
    prisma as unknown as PrismaService,
    {} as unknown as AccessionSettingsService,
    {} as unknown as LabReportService,
    pdf as unknown as PdfReportTemplateService,
    {} as unknown as PdfTemplateConfigService,
    {} as unknown as EventEmitter2,
    tenants as unknown as TenantService,
    barcodes as unknown as BarcodeService,
    {} as unknown as UserDepartmentScopeService,
    {} as unknown as AppointmentService,
  );
  jest.spyOn(service, 'findById').mockImplementation((id: string) => Promise.resolve(samples[id]!));
  (service as unknown as { buildLabelContext: jest.Mock }).buildLabelContext = jest.fn().mockResolvedValue({});
  const labels = () =>
    ((pdf.generatePdf.mock.calls[0] as [string, string, { sections?: { labels?: unknown[] } }])[2].sections?.labels ?? []);
  return { service, updateMany, barcodes, pdf, labels };
}

describe('printLabels leaves out samples with no barcode', () => {
  it('prints the samples that have one and says how many were left out', async () => {
    const m = build({ a: sample('a', '10001', 'https://img/10001'), b: sample('b', null, null), c: sample('c', '10002', 'https://img/10002') });
    const out = await m.service.printLabels(['a', 'b', 'c'], 't1', null, 'tpl');
    expect(out.skipped).toBe(1);
    expect(m.labels()).toHaveLength(2);
  });

  it('nothing skipped when every sample has a barcode', async () => {
    const m = build({ a: sample('a', '10001', 'https://img/10001') });
    expect((await m.service.printLabels(['a'], 't1', null, 'tpl')).skipped).toBe(0);
  });

  it('refuses (no PDF) when none of them has a barcode', async () => {
    const m = build({ a: sample('a', null, null), b: sample('b', null, null) });
    await expect(m.service.printLabels(['a', 'b'], 't1', null, 'tpl')).rejects.toBeInstanceOf(NoBarcodeToPrintException);
    expect(m.pdf.generatePdf).not.toHaveBeenCalled();
  });

  it('a single label of a sample with no barcode is refused too', async () => {
    const m = build({ a: sample('a', null, null) });
    await expect(m.service.printLabel('a', 't1', null, 'tpl')).rejects.toMatchObject({
      response: { error: { code: 'NO_BARCODE_TO_PRINT' } },
    });
    expect(m.pdf.generatePdf).not.toHaveBeenCalled();
  });
});

describe('the barcode picture is made at print time when it is missing', () => {
  it('makes it once per barcode, keeps it, and prints', async () => {
    const m = build({ a: sample('a', '10001', null), b: sample('b', '10001', null), c: sample('c', '10002', 'https://img/10002') });
    await m.service.printLabels(['a', 'b', 'c'], 't1', null, 'tpl');
    expect(m.barcodes.generateAndUpload).toHaveBeenCalledTimes(1); // one picture for the shared barcode 10001
    expect(m.barcodes.generateAndUpload).toHaveBeenCalledWith('10001', 't1');
    expect(m.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['a', 'b'] }, tenantId: 't1' },
      data: { orderIdBarcode: 'https://img/10001' },
    });
    expect(m.pdf.generatePdf).toHaveBeenCalledTimes(1);
  });

  it('does nothing when every picture exists', async () => {
    const m = build({ a: sample('a', '10001', 'https://img/10001') });
    await m.service.printLabels(['a'], 't1', null, 'tpl');
    expect(m.barcodes.generateAndUpload).not.toHaveBeenCalled();
    expect(m.updateMany).not.toHaveBeenCalled();
  });

  it('a single label does the same', async () => {
    const m = build({ a: sample('a', '10001', null) });
    await m.service.printLabel('a', 't1', null, 'tpl');
    expect(m.barcodes.generateAndUpload).toHaveBeenCalledWith('10001', 't1');
  });

  it('with the storage still down the print is refused with a clear message, never a label with an empty image', async () => {
    const m = build({ a: sample('a', '10001', null) }, false);
    await expect(m.service.printLabels(['a'], 't1', null, 'tpl')).rejects.toBeInstanceOf(BarcodeImageUnavailableException);
    await expect(m.service.printLabel('a', 't1', null, 'tpl')).rejects.toMatchObject({
      response: { error: { code: 'BARCODE_IMAGE_UNAVAILABLE' } },
    });
    expect(m.pdf.generatePdf).not.toHaveBeenCalled();
    expect(m.updateMany).not.toHaveBeenCalled();
  });
});
