import { Injectable, Logger } from '@nestjs/common';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { KaltrosException } from '../../common/exceptions/kaltros.exception';
import {
  IndiaLocationDataFileNotFoundException,
  IndiaLocationDataMalformedException,
  IndiaLocationSyncFailedException,
} from './exceptions/location.exceptions';

/** One state/UT entry as it appears in the India location master JSON. */
interface IndiaStateJson {
  name: string;
  /** `STATE` | `UNION_TERRITORY` in the source; the State model has no type field so this is informational only. */
  type: string;
  /** District names — mapped to City rows under the state. */
  districts: string[];
}

/** Validated root shape of `jsons/location/index.json`. */
interface IndiaLocationJson {
  country: string;
  states: IndiaStateJson[];
}

/** Per-tier tally (created vs. already-present) returned after a sync run. */
export interface SyncTierResult {
  created: number;
  existing: number;
}

/** Summary of a full India location sync, one entry per hierarchy tier. */
export interface SyncIndiaResult {
  countries: SyncTierResult;
  states: SyncTierResult;
  cities: SyncTierResult;
}

/** The single country this sync manages. */
const INDIA_COUNTRY_NAME = 'India';
const INDIA_COUNTRY_CODE = 'IN';

/** Project-relative location of the bundled master JSON. */
const JSON_RELATIVE = join('jsons', 'location', 'index.json');

/** Case/whitespace-insensitive key used to match names idempotently. */
function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Derive a short, non-null `code` for a state/UT (the JSON carries none, and the
 * column is required). Codes are not unique keys, so a simple deterministic
 * abbreviation is fine and keeps re-runs stable.
 */
function deriveStateCode(name: string): string {
  const alpha = name.toUpperCase().replace(/[^A-Z]/g, '');
  return alpha.slice(0, 5) || 'NA';
}

/**
 * Bulk import of the bundled India location master (country → states/UTs →
 * districts-as-cities) into the platform-level location tables. Platform-level
 * data (no tenant scoping / RLS), so plain Prisma is used.
 *
 * The sync is **idempotent**: it matches existing rows by normalized name within
 * their parent, creates only what is missing, and never deletes. Running it
 * repeatedly converges to the same state without producing duplicates.
 */
@Injectable()
export class LocationSyncService {
  private readonly logger = new Logger(LocationSyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Import/refresh the India location master from the bundled JSON.
   * @returns per-tier tallies of created vs. already-existing records
   * @throws IndiaLocationDataFileNotFoundException if the JSON cannot be located
   * @throws IndiaLocationDataMalformedException if the JSON is invalid/mis-shaped
   * @throws IndiaLocationSyncFailedException if a database error aborts the sync
   */
  async syncIndiaData(): Promise<SyncIndiaResult> {
    const data = this.loadIndiaData();

    try {
      return await this.prisma.$transaction(
        (tx) => this.runSync(tx, data),
        // Bulk `createMany`s over ~36 states / ~780 districts run in a handful of
        // statements; generous bounds keep the whole thing atomic under load.
        { timeout: 60_000, maxWait: 15_000 },
      );
    } catch (err) {
      if (err instanceof KaltrosException) throw err;
      this.logger.error(
        `India location sync failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
      throw new IndiaLocationSyncFailedException((err as Error).message);
    }
  }

  /**
   * Core sync body, run inside a transaction so a partial failure rolls back
   * cleanly. Preloads existing rows into maps/sets and creates only the missing
   * ones in bulk, preserving the country → state → city relationships.
   */
  private async runSync(
    tx: Prisma.TransactionClient,
    data: IndiaLocationJson,
  ): Promise<SyncIndiaResult> {
    const result: SyncIndiaResult = {
      countries: { created: 0, existing: 0 },
      states: { created: 0, existing: 0 },
      cities: { created: 0, existing: 0 },
    };

    // ── 1. Country (India) ──────────────────────────────────────────────
    // Match case-insensitively (consistent with how states/cities are matched)
    // so a pre-existing differently-cased "india" is reused, not duplicated —
    // the table has no unique name constraint. `orderBy` makes the pick
    // deterministic (reuse the earliest) across re-runs.
    let country = await tx.country.findFirst({
      where: {
        name: { equals: INDIA_COUNTRY_NAME, mode: 'insensitive' },
        deletedAt: null,
      },
      orderBy: { createdAt: 'asc' },
    });
    if (country) {
      result.countries.existing += 1;
    } else {
      country = await tx.country.create({
        data: { name: INDIA_COUNTRY_NAME, code: INDIA_COUNTRY_CODE },
      });
      result.countries.created += 1;
    }
    const countryId = country.id;

    // ── 2. States / Union Territories ───────────────────────────────────
    const existingStates = await tx.state.findMany({
      where: { countryId, deletedAt: null },
      select: { id: true, name: true },
    });
    const stateIdByKey = new Map<string, string>();
    for (const s of existingStates)
      stateIdByKey.set(normalizeName(s.name), s.id);

    const statesToCreate: Prisma.StateCreateManyInput[] = [];
    for (const st of data.states) {
      if (stateIdByKey.has(normalizeName(st.name))) {
        result.states.existing += 1;
      } else {
        statesToCreate.push({
          name: st.name,
          code: deriveStateCode(st.name),
          countryId,
        });
      }
    }
    if (statesToCreate.length > 0) {
      await tx.state.createMany({ data: statesToCreate });
      result.states.created += statesToCreate.length;
    }

    // Rebuild the name→id map so newly created states are resolvable for cities.
    const allStates = await tx.state.findMany({
      where: { countryId, deletedAt: null },
      select: { id: true, name: true },
    });
    stateIdByKey.clear();
    for (const s of allStates) stateIdByKey.set(normalizeName(s.name), s.id);

    // ── 3. Cities (districts) ───────────────────────────────────────────
    const existingCities = await tx.city.findMany({
      where: { countryId, deletedAt: null },
      select: { name: true, stateId: true },
    });
    // Dedupe key = parent state + normalized district name.
    const citySeen = new Set<string>();
    for (const c of existingCities) {
      citySeen.add(`${c.stateId}::${normalizeName(c.name)}`);
    }

    const citiesToCreate: Prisma.CityCreateManyInput[] = [];
    for (const st of data.states) {
      const stateId = stateIdByKey.get(normalizeName(st.name));
      if (!stateId) continue; // unreachable: every JSON state was just upserted
      for (const district of st.districts) {
        const key = `${stateId}::${normalizeName(district)}`;
        if (citySeen.has(key)) {
          result.cities.existing += 1;
          continue;
        }
        citySeen.add(key); // guard against duplicate districts within the JSON
        citiesToCreate.push({
          name: district,
          pinCode: '', // districts carry no PIN in the source; required column
          stateId,
          countryId,
        });
      }
    }
    if (citiesToCreate.length > 0) {
      await tx.city.createMany({ data: citiesToCreate });
      result.cities.created += citiesToCreate.length;
    }

    return result;
  }

  /**
   * Read, parse and structurally validate the bundled India JSON.
   * @throws IndiaLocationDataFileNotFoundException / IndiaLocationDataMalformedException
   */
  private loadIndiaData(): IndiaLocationJson {
    const path = this.resolveJsonPath();

    let raw: string;
    try {
      raw = readFileSync(path, 'utf8');
    } catch (err) {
      throw new IndiaLocationDataFileNotFoundException(
        [path],
        (err as Error).message,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new IndiaLocationDataMalformedException(
        `invalid JSON: ${(err as Error).message}`,
      );
    }

    return this.assertShape(parsed);
  }

  /**
   * Resolve the JSON with a runtime-safe path — no developer absolute paths. The
   * file ships at the repo root (`jsons/`), so `process.cwd()` resolves it in
   * dev and in production (the process runs from the app root). The remaining
   * candidates cover a dist-only deploy and `__dirname`-relative layouts.
   */
  private resolveJsonPath(): string {
    const candidates = [
      join(process.cwd(), JSON_RELATIVE),
      join(process.cwd(), 'dist', JSON_RELATIVE),
      // dev: <root>/src/modules/location → <root>
      join(__dirname, '..', '..', '..', JSON_RELATIVE),
      // prod: <root>/dist/src/modules/location → <root>
      join(__dirname, '..', '..', '..', '..', JSON_RELATIVE),
      // dist-bundled asset next to compiled code (see nest-cli.json assets)
      join(__dirname, '..', '..', '..', 'jsons', 'location', 'index.json'),
    ];
    const found = candidates.find((p) => existsSync(p));
    if (!found) {
      throw new IndiaLocationDataFileNotFoundException(candidates);
    }
    return found;
  }

  /**
   * Validate the parsed JSON against the shape we depend on, coercing/cleaning
   * as we go. Fails loudly (typed exception) rather than importing garbage.
   */
  private assertShape(parsed: unknown): IndiaLocationJson {
    if (typeof parsed !== 'object' || parsed === null) {
      throw new IndiaLocationDataMalformedException('root is not an object');
    }
    const root = parsed as Record<string, unknown>;
    const list = root['states_and_union_territories'];
    if (!Array.isArray(list)) {
      throw new IndiaLocationDataMalformedException(
        '"states_and_union_territories" must be an array',
      );
    }

    const states: IndiaStateJson[] = [];
    for (const entry of list) {
      if (typeof entry !== 'object' || entry === null) {
        throw new IndiaLocationDataMalformedException(
          'a state entry is not an object',
        );
      }
      const e = entry as Record<string, unknown>;
      const name = e['name'];
      if (typeof name !== 'string' || name.trim() === '') {
        throw new IndiaLocationDataMalformedException(
          'a state entry is missing a valid "name"',
        );
      }
      const districts = e['districts'];
      if (!Array.isArray(districts)) {
        throw new IndiaLocationDataMalformedException(
          `state "${name}" has no "districts" array`,
        );
      }
      const cleanDistricts = districts.filter(
        (d): d is string => typeof d === 'string' && d.trim() !== '',
      );
      states.push({
        name: name.trim(),
        type: typeof e['type'] === 'string' ? e['type'] : 'STATE',
        districts: cleanDistricts.map((d) => d.trim()),
      });
    }

    const country =
      typeof root['country'] === 'string' && root['country'].trim() !== ''
        ? root['country'].trim()
        : INDIA_COUNTRY_NAME;

    return { country, states };
  }
}
