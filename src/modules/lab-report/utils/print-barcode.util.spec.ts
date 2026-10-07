import { buildReportBarcodeTags, pickReportSample } from './print-barcode.util';

// Echo the encoded value so the test sees exactly which ID each tag received.
jest.mock('../../../common/utils/barcode-image.util', () => ({
  code128DataUri: (value: string | null | undefined) =>
    value ? `barcode:${value}` : '',
}));

describe('buildReportBarcodeTags', () => {
  it('puts the Order ID on order_id_barcode and the Sample ID on order_id_qr_code', () => {
    expect(buildReportBarcodeTags('10020', '10023')).toEqual({
      order_id_barcode: 'barcode:10020',
      order_id_qr_code: 'barcode:10023',
    });
  });

  it('keeps each tag on its own source when the two counters share a number', () => {
    expect(buildReportBarcodeTags('10020', null)).toEqual({
      order_id_barcode: 'barcode:10020',
      order_id_qr_code: '',
    });
    expect(buildReportBarcodeTags(null, '10020')).toEqual({
      order_id_barcode: '',
      order_id_qr_code: 'barcode:10020',
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
