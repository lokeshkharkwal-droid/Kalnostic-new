import { buildReportBarcodeTags, pickReportSample } from './print-barcode.util';

// Echo the encoded value so the test sees exactly which ID (and which
// symbology) each tag received.
jest.mock('../../../common/utils/barcode-image.util', () => ({
  code128DataUri: (value: string | null | undefined) =>
    value ? `barcode:${value}` : '',
  qrCodeDataUri: (value: string | null | undefined) =>
    Promise.resolve(value ? `qr:${value}` : ''),
}));

describe('buildReportBarcodeTags', () => {
  it('puts the Order ID (order code) on order_id_barcode and order_id_qr_code (as a QR), and the Sample ID on sample_id_barcode', async () => {
    await expect(buildReportBarcodeTags('ORD-00113', '10008')).resolves.toEqual(
      {
        order_id_barcode: 'barcode:ORD-00113',
        order_id_qr_code: 'qr:ORD-00113',
        sample_id_barcode: 'barcode:10008',
      },
    );
  });

  it('keeps each tag on its own source when one ID is unset', async () => {
    await expect(buildReportBarcodeTags('ORD-00113', null)).resolves.toEqual({
      order_id_barcode: 'barcode:ORD-00113',
      order_id_qr_code: 'qr:ORD-00113',
      sample_id_barcode: '',
    });
    await expect(buildReportBarcodeTags(null, '10008')).resolves.toEqual({
      order_id_barcode: '',
      order_id_qr_code: '',
      sample_id_barcode: 'barcode:10008',
    });
  });
});

describe('pickReportSample', () => {
  it('prefers the first sample that carries a barcode', () => {
    const picked = pickReportSample([
      { sample: { id: 'a', barcode: null } },
      { sample: { id: 'b', barcode: '10023' } },
      { sample: { id: 'c', barcode: '10024' } },
    ]);
    expect(picked?.id).toBe('b');
  });

  it('falls back to the first sample, or undefined when there is none', () => {
    expect(pickReportSample([{ sample: { id: 'a', barcode: null } }])?.id).toBe(
      'a',
    );
    expect(pickReportSample([])).toBeUndefined();
  });
});
