import { code128DataUri, renderCode128Png } from './barcode-image.util';
import { BarcodeService } from '../../modules/accession/barcode.service';
import type { UploadsService } from '../../modules/uploads/uploads.service';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

describe('code128DataUri', () => {
  it('returns a PNG data URI of the Code 128 render', () => {
    const uri = code128DataUri('10020');
    expect(uri.startsWith('data:image/png;base64,')).toBe(true);
    const png = Buffer.from(uri.split(',')[1] ?? '', 'base64');
    expect(png.subarray(0, 4)).toEqual(PNG_SIGNATURE);
    expect(png).toEqual(renderCode128Png('10020'));
  });

  it('encodes different values to different images', () => {
    expect(code128DataUri('10020')).not.toBe(code128DataUri('10023'));
  });

  it('returns empty for an unset value', () => {
    expect(code128DataUri('')).toBe('');
    expect(code128DataUri(null)).toBe('');
    expect(code128DataUri(undefined)).toBe('');
  });

  it('returns empty when Code 128 cannot encode the value', () => {
    expect(code128DataUri('नमूना')).toBe('');
  });
});

describe('BarcodeService.renderCode128Png', () => {
  it('produces the same image as the shared util (one generator)', () => {
    const service = new BarcodeService({} as UploadsService);
    expect(service.renderCode128Png('BAR-00001-A')).toEqual(
      renderCode128Png('BAR-00001-A'),
    );
  });
});
