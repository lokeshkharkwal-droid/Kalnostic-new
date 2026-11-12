import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SaveDateFilterPreferenceDto } from './dto/save-date-filter-preference.dto';
import {
  DATE_FILTER_SCREEN_KEYS,
  type DateFilterPreset,
  type DateFilterScreenKey,
} from './user-preference.constants';
import {
  InvalidDateFilterRangeException,
  InvalidDateFilterScreenException,
} from './exceptions/user-preference.exceptions';

/** The caller's saved default date filter for one screen, as the API returns it. */
export interface DateFilterPreferenceEntity {
  screenKey: DateFilterScreenKey;
  preset: DateFilterPreset;
  /** `YYYY-MM-DD` for CUSTOM, otherwise null. */
  dateFrom: string | null;
  dateTo: string | null;
  updatedAt: Date;
}

/**
 * Personal UI preferences. Every query is scoped to the caller's tenant AND
 * person (both from the JWT, never the request), so a user can only ever read or
 * change their own defaults. Soft-deleted rows are ignored.
 */
@Injectable()
export class UserPreferenceService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Validate and narrow a `:screenKey` route param.
   * @throws InvalidDateFilterScreenException for an unknown screen
   */
  assertScreenKey(screenKey: string): DateFilterScreenKey {
    if (!(DATE_FILTER_SCREEN_KEYS as readonly string[]).includes(screenKey)) {
      throw new InvalidDateFilterScreenException(screenKey);
    }
    return screenKey as DateFilterScreenKey;
  }

  /**
   * The caller's saved default date filter for a screen.
   * @returns the preference, or `null` when none is saved
   */
  async getDateFilter(
    tenantId: string,
    personId: string,
    screenKey: string,
  ): Promise<DateFilterPreferenceEntity | null> {
    const key = this.assertScreenKey(screenKey);
    const row = await this.prisma.userDateFilterPreference.findFirst({
      where: { tenantId, personId, screenKey: key, deletedAt: null },
    });
    return row ? this.toEntity(row) : null;
  }

  /**
   * Create or replace the caller's default date filter for a screen. Dates are
   * kept only for CUSTOM.
   * @throws InvalidDateFilterRangeException when CUSTOM `dateFrom` > `dateTo`
   */
  async saveDateFilter(
    tenantId: string,
    personId: string,
    screenKey: string,
    dto: SaveDateFilterPreferenceDto,
  ): Promise<DateFilterPreferenceEntity> {
    const key = this.assertScreenKey(screenKey);
    const isCustom = dto.preset === 'CUSTOM';
    if (isCustom && dto.dateFrom! > dto.dateTo!) {
      throw new InvalidDateFilterRangeException(dto.dateFrom!, dto.dateTo!);
    }
    const data = {
      preset: dto.preset,
      dateFrom: isCustom ? new Date(`${dto.dateFrom}T00:00:00.000Z`) : null,
      dateTo: isCustom ? new Date(`${dto.dateTo}T00:00:00.000Z`) : null,
    };
    const row = await this.prisma.userDateFilterPreference.upsert({
      where: {
        tenantId_personId_screenKey: { tenantId, personId, screenKey: key },
      },
      create: { tenantId, personId, screenKey: key, ...data },
      update: { ...data, deletedAt: null },
    });
    return this.toEntity(row);
  }

  /** Remove the caller's default for a screen (the screen falls back to Today). */
  async resetDateFilter(
    tenantId: string,
    personId: string,
    screenKey: string,
  ): Promise<{ screenKey: DateFilterScreenKey; reset: true }> {
    const key = this.assertScreenKey(screenKey);
    await this.prisma.userDateFilterPreference.updateMany({
      where: { tenantId, personId, screenKey: key, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return { screenKey: key, reset: true };
  }

  /** `@db.Date` comes back as a UTC-midnight Date — return it as `YYYY-MM-DD`. */
  private toEntity(row: {
    screenKey: string;
    preset: string;
    dateFrom: Date | null;
    dateTo: Date | null;
    updatedAt: Date;
  }): DateFilterPreferenceEntity {
    const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
    return {
      screenKey: row.screenKey as DateFilterScreenKey,
      preset: row.preset as DateFilterPreset,
      dateFrom: day(row.dateFrom),
      dateTo: day(row.dateTo),
      updatedAt: row.updatedAt,
    };
  }
}
