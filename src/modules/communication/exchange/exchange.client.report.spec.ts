import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { ConfigService } from '@nestjs/config';
import { ExchangeClient } from './exchange.client';

/**
 * The report calls (`/notifications/items`, `/notifications/itemDetail`) must
 * send a JSON body on a GET — the legacy `_exchangeApi` contract — which `fetch`
 * cannot do. These run against a throwaway HTTP server on 127.0.0.1.
 */
describe('ExchangeClient report calls', () => {
  interface Captured {
    method?: string;
    url?: string;
    headers: http.IncomingHttpHeaders;
    body: unknown;
  }
  let server: http.Server;
  let base: string;
  let captured: Captured;
  let reply: (res: http.ServerResponse) => void;

  const client = (overrides: Record<string, unknown> = {}): ExchangeClient => {
    const values: Record<string, unknown> = {
      'exchange.url': `${base}/social/api/v1/notifications`,
      'exchange.key': 'k-test',
      'exchange.secret': 's-test',
      'exchange.frontendUrl': 'https://app.example',
      'exchange.timeoutMs': 2000,
      ...overrides,
    };
    return new ExchangeClient({
      get: (key: string, fallback?: unknown) =>
        key in values ? values[key] : fallback,
    } as unknown as ConfigService);
  };

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        captured = {
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: raw ? (JSON.parse(raw) as unknown) : null,
        };
        reply(res);
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    captured = { headers: {}, body: null };
    reply = (res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ s: '200', data: { data: [], total: 0 } }));
    };
  });

  it('lists items with a GET + JSON body envelope scoped to the tenant', async () => {
    const resp = await client().listNotificationItems(
      { tenantId: '4321', tenantInfo: 'Lab' },
      {
        contextType: 'whatsapp',
        page: 2,
        periodFrom: '2026-01-01 00:00:00',
        periodTo: '2026-11-23 23:59:59',
        dateRange: '1 Jan 2026 - 23 Nov 2026',
        status: 'failed',
      },
    );
    expect(resp).toEqual({ s: '200', data: { data: [], total: 0 } });
    expect(captured.method).toBe('GET');
    expect(captured.url).toBe('/social/api/v1/notifications/items');
    expect(captured.headers).toMatchObject({
      'content-type': 'application/json',
      key: 'k-test',
      secret: 's-test',
      peer_tenant_id: '4321',
    });
    expect(captured.body).toEqual({
      data: {
        key: 'k-test',
        secret: 's-test',
        peer_tenant_id: 4321,
        peer_branch_id: 0,
        peer_tenant_info: 'Lab',
        peer_server_url: 'https://app.example',
        peer_branch_info: '',
        data: {
          peer_tenant_id: 4321,
          context_type: 'whatsapp',
          page: 2,
          period_from: '2026-01-01 00:00:00',
          period_to: '2026-11-23 23:59:59',
          date_range: '1 Jan 2026 - 23 Nov 2026',
          status: 'failed',
        },
      },
    });
  });

  it('omits status for All', async () => {
    await client().listNotificationItems(
      { tenantId: '4321' },
      {
        contextType: 'sms',
        page: 1,
        periodFrom: '2026-11-23 00:00:00',
        periodTo: '2026-11-23 23:59:59',
        dateRange: '23 Nov 2026',
      },
    );
    const inner = (captured.body as { data: { data: Record<string, unknown> } })
      .data.data;
    expect(inner).not.toHaveProperty('status');
    expect(inner.context_type).toBe('sms');
  });

  it('fetches one item detail', async () => {
    reply = (res) =>
      res.end(JSON.stringify({ s: '200', data: { id: 9, context_id: '91' } }));
    const resp = await client().getNotificationItemDetail(
      { tenantId: '4321' },
      9,
    );
    expect(resp).toEqual({ s: '200', data: { id: 9, context_id: '91' } });
    expect(captured.method).toBe('GET');
    expect(captured.url).toBe('/social/api/v1/notifications/itemDetail');
    expect((captured.body as { data: { data: unknown } }).data.data).toEqual({
      peer_tenant_id: 4321,
      id: 9,
    });
  });

  it('returns null (never throws) on a non-JSON answer, a timeout, or no config', async () => {
    reply = (res) => res.end('<html>oops</html>');
    await expect(
      client().getNotificationItemDetail({ tenantId: '1' }, 1),
    ).resolves.toBeNull();

    reply = () => undefined; // never answers
    await expect(
      client({ 'exchange.timeoutMs': 150 }).getNotificationItemDetail(
        { tenantId: '1' },
        1,
      ),
    ).resolves.toBeNull();

    captured = { headers: {}, body: null };
    await expect(
      client({ 'exchange.key': undefined }).getNotificationItemDetail(
        { tenantId: '1' },
        1,
      ),
    ).resolves.toBeNull();
    expect(captured.method).toBeUndefined();
  });

  it('isReportOk accepts s or status 200 only', () => {
    const c = client();
    expect(c.isReportOk({ s: '200' })).toBe(true);
    expect(c.isReportOk({ status: 200 })).toBe(true);
    expect(c.isReportOk({ s: '500' })).toBe(false);
    expect(c.isReportOk(null)).toBe(false);
  });
});
