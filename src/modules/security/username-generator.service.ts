import { Injectable } from '@nestjs/common';
import { randomInt } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Generates unique system usernames for people registered without phone/email
 * (ported from kaltros-master). Format: `{ISO2}{3 alpha}-{5 digits}`, e.g.
 * `INABC-12345`. Letters exclude I/O (CLAUDE.md §5.3).
 */
@Injectable()
export class UsernameGeneratorService {
  /** Letters excluding I and O. */
  private readonly SAFE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  private readonly DIGITS = '0123456789';

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Generate a unique system username, retrying on the (extremely unlikely)
   * collision.
   * @param countryCode ISO 3166-1 alpha-2 code (default 'IN')
   * @throws Error if no unique value is found after 10 attempts
   */
  async generate(countryCode = 'IN'): Promise<string> {
    const MAX_ATTEMPTS = 10;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const candidate = this.generateCandidate(countryCode);
      const taken = await this.prisma.personCredentials.findUnique({
        where: { systemUsername: candidate },
        select: { id: true },
      });
      if (!taken) {
        return candidate;
      }
    }
    throw new Error(
      `Failed to generate unique system username after ${MAX_ATTEMPTS} attempts`,
    );
  }

  /** Build a single candidate username (not guaranteed unique). */
  private generateCandidate(countryCode: string): string {
    const letters = Array.from(
      { length: 3 },
      () => this.SAFE_LETTERS[randomInt(this.SAFE_LETTERS.length)],
    ).join('');
    const numbers = Array.from(
      { length: 5 },
      () => this.DIGITS[randomInt(this.DIGITS.length)],
    ).join('');
    return `${countryCode}${letters}-${numbers}`;
  }
}
