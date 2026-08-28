import { Controller, Get, Logger, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { extractClientIp } from '../../common/utils/client-ip.util';
import { EmiService } from './emi.service';
import { EMI } from './entities/emi-response.entity';
import { SubmitResultBody } from './dto/submit-result.dto';

/**
 * External Machine Interface (EMI) — the lab-analyzer compatibility layer that
 * reproduces the legacy EzHealthTrack `/emi` contract so existing machines
 * integrate with only a host change (CLAUDE.md §0: mirror the reference).
 *
 * These routes are:
 * - **`@Public()`** — authenticated by a `TOKEN` header (an active
 *   `LabAdapter.token`), not the business JWT, so they opt out of the global
 *   `JwtAuthGuard`.
 * - **served at the root** (`/emi/orders`, `/emi/submitResult`) — excluded from
 *   the global `api/v1` prefix in `main.ts`.
 * - **raw-response** — every handler writes the flat legacy `{ s, m, … }`
 *   envelope via `@Res()`, bypassing the global `ResponseInterceptor` /
 *   `HttpExceptionFilter` (a machine can't parse our `{ success, data, meta }`
 *   shape). All errors are caught and returned as `{ s: "500" }`.
 *
 * The submit body arrives as a GET request with a `text/plain` JSON body (legacy
 * quirk), parsed by the raw-body middleware scoped to `/emi/submitResult` in
 * `main.ts` and JSON-decoded here.
 */
@Public()
@Controller('emi')
export class EmiController {
  private readonly logger = new Logger(EmiController.name);

  constructor(private readonly emiService: EmiService) {}

  /**
   * `GET /emi/orders?specimen_id=<orderCode>` — order + patient + pending tests
   * for a scanned id.
   */
  @Get('orders')
  async orders(@Req() req: Request, @Res() res: Response): Promise<void> {
    const token = this.headerToken(req);
    if (token === null) {
      res.json({ s: EMI.BAD_REQUEST, m: 'Missing Auth token' });
      return;
    }
    const adapter = await this.emiService.resolveAdapterByToken(token);
    if (!adapter) {
      res.json({ s: EMI.INVALID_AUTH, m: 'Invalid authorization' });
      return;
    }
    const specimenId =
      typeof req.query.specimen_id === 'string'
        ? req.query.specimen_id
        : undefined;
    try {
      res.json(await this.emiService.getOrders(adapter, specimenId));
    } catch (e) {
      this.logger.error(
        `GET /emi/orders failed: ${e instanceof Error ? e.message : String(e)}`,
        e instanceof Error ? e.stack : undefined,
      );
      res.json({ s: EMI.INTERNAL_ERROR, m: 'Internal server error' });
    }
  }

  /**
   * `GET /emi/submitResult` — fill the machine's result values onto the order's
   * reports.
   */
  @Get('submitResult')
  async submitResult(@Req() req: Request, @Res() res: Response): Promise<void> {
    const token = this.headerToken(req);
    if (token === null) {
      res.json({ s: EMI.BAD_REQUEST, m: 'Missing Auth token' });
      return;
    }
    const adapter = await this.emiService.resolveAdapterByToken(token);
    if (!adapter) {
      res.json({ s: EMI.INVALID_AUTH, m: 'Invalid authorization' });
      return;
    }
    const body = this.parseBody(req);
    if (body === null) {
      res.json({ s: EMI.INTERNAL_ERROR, m: 'Malformed request body' });
      return;
    }
    try {
      const result = await this.emiService.submitResult(
        adapter,
        body,
        extractClientIp(req),
      );
      res.json(result);
    } catch (e) {
      this.logger.error(
        `GET /emi/submitResult failed: ${e instanceof Error ? e.message : String(e)}`,
        e instanceof Error ? e.stack : undefined,
      );
      res.json({ s: EMI.INTERNAL_ERROR, m: 'Internal server error' });
    }
  }

  /**
   * Read the `TOKEN` header. Returns the trimmed token, or `null` when absent —
   * the caller maps `null` to `400 Missing Auth token` (an unknown but present
   * token becomes `403 Invalid authorization` after the DB lookup).
   */
  private headerToken(req: Request): string | null {
    const raw = req.headers['token'];
    const value = Array.isArray(raw) ? raw[0] : raw;
    const trimmed = typeof value === 'string' ? value.trim() : '';
    return trimmed === '' ? null : trimmed;
  }

  /**
   * Decode the submit body. The raw-body middleware delivers a string (JSON under
   * `text/plain`); an empty body is treated as an empty payload. Returns `null`
   * only when the body is present but not valid JSON.
   */
  private parseBody(req: Request): SubmitResultBody | null {
    const raw: unknown = req.body;
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (trimmed === '') {
        return {};
      }
      try {
        return JSON.parse(trimmed) as SubmitResultBody;
      } catch {
        return null;
      }
    }
    if (raw && typeof raw === 'object') {
      return raw as SubmitResultBody;
    }
    return {};
  }
}
