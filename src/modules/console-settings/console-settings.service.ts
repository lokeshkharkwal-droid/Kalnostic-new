import { BadRequestException, Injectable } from '@nestjs/common';
import { ConsoleSetting } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SaveConsoleSettingsDto } from './dto/save-console-settings.dto';

interface TatTier {
  label: string;
  warningKey: 'routineWarningHours' | 'urgentWarningHours' | 'statWarningHours';
  breachKey: 'routineBreachHours' | 'urgentBreachHours' | 'statBreachHours';
}

const TAT_TIERS: TatTier[] = [
  {
    label: 'Routine',
    warningKey: 'routineWarningHours',
    breachKey: 'routineBreachHours',
  },
  {
    label: 'Urgent',
    warningKey: 'urgentWarningHours',
    breachKey: 'urgentBreachHours',
  },
  {
    label: 'STAT',
    warningKey: 'statWarningHours',
    breachKey: 'statBreachHours',
  },
];

/**
 * Tenant-level console settings for Registration. The row is created on
 * first access so the frontend always receives a complete settings object.
 */
@Injectable()
export class ConsoleSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Return the current tenant's settings, creating defaults if missing. */
  async getSettings(tenantId: string): Promise<ConsoleSetting> {
    return this.prisma.consoleSetting.upsert({
      where: { tenantId },
      create: { tenantId },
      update: {},
    });
  }

  /** Save a partial/full settings payload with upsert semantics. */
  async saveSettings(
    tenantId: string,
    dto: SaveConsoleSettingsDto,
  ): Promise<ConsoleSetting> {
    const existing = await this.prisma.consoleSetting.findUnique({
      where: { tenantId },
    });

    for (const tier of TAT_TIERS) {
      const warning = dto[tier.warningKey] ?? existing?.[tier.warningKey];
      const breach = dto[tier.breachKey] ?? existing?.[tier.breachKey];
      if (warning !== undefined && breach !== undefined && breach <= warning) {
        throw new BadRequestException(
          `${tier.label} breach hours must exceed warning hours`,
        );
      }
    }

    return this.prisma.consoleSetting.upsert({
      where: { tenantId },
      create: { tenantId, ...dto },
      update: { ...dto },
    });
  }
}
