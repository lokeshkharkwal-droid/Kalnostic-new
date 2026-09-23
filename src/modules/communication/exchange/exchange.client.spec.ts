import { ConfigService } from '@nestjs/config';
import { ExchangeClient } from './exchange.client';

describe('ExchangeClient.baseUrl', () => {
  const client = new ExchangeClient({} as unknown as ConfigService);
  const baseUrl = (url: string): string =>
    (client as unknown as { baseUrl: (u: string) => string }).baseUrl(url);

  it('returns a base URL unchanged (minus trailing slash)', () => {
    expect(baseUrl('https://x/social/api/v1')).toBe('https://x/social/api/v1');
    expect(baseUrl('https://x/social/api/v1/')).toBe('https://x/social/api/v1');
  });

  it('strips a trailing /notifications so resource paths append cleanly', () => {
    expect(baseUrl('https://x/social/api/v1/notifications')).toBe(
      'https://x/social/api/v1',
    );
  });
});
