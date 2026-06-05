import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';

/**
 * Password generation, hashing, and policy validation (ported from
 * kaltros-master). Preserve the policy & formats exactly (CLAUDE.md §5.3).
 *
 * Policy: min 8 chars, ≥1 uppercase, ≥1 digit. bcrypt cost defaults to 12.
 * Generated temp passwords are shared with users out-of-band (printed/WhatsApp).
 */
@Injectable()
export class PasswordService {
  /** Uppercase letters excluding I and O (visual confusion with 1/0). */
  private readonly UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  /** Lowercase letters excluding i and o. */
  private readonly LOWER = 'abcdefghjklmnpqrstuvwxyz';
  /** Digits excluding 0 and 1. */
  private readonly DIGITS = '23456789';

  private readonly rounds: number;

  constructor(private readonly config: ConfigService) {
    this.rounds = this.config.get<number>('BCRYPT_ROUNDS', 12);
  }

  /**
   * Generate a policy-compliant temp password: 1 upper + 5 lower + 2 digits
   * (e.g. "Abcdef78"), excluding visually confusing characters.
   * @returns plain-text password (caller must hash before storing)
   */
  generateTempPassword(): string {
    const upper = this.pick(this.UPPER);
    const lower = Array.from({ length: 5 }, () => this.pick(this.LOWER)).join(
      '',
    );
    const digits = Array.from({ length: 2 }, () => this.pick(this.DIGITS)).join(
      '',
    );
    return upper + lower + digits;
  }

  /**
   * Hash a plain-text password with bcrypt.
   * @param plainText the password to hash
   */
  async hash(plainText: string): Promise<string> {
    return bcrypt.hash(plainText, this.rounds);
  }

  /**
   * Verify a plain-text password against a stored bcrypt hash.
   * @param plainText entered password
   * @param hash stored bcrypt hash
   */
  async verify(plainText: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plainText, hash);
  }

  /**
   * Validate a password against policy.
   * @param password candidate password
   * @returns null if valid, otherwise a human-readable error message
   */
  validate(password: string): string | null {
    if (password.length < 8) {
      return 'Password must be at least 8 characters long';
    }
    if (!/[A-Z]/.test(password)) {
      return 'Password must contain at least one uppercase letter';
    }
    if (!/[0-9]/.test(password)) {
      return 'Password must contain at least one number';
    }
    return null;
  }

  /** Pick one random character from a set using a CSPRNG. */
  private pick(set: string): string {
    return set[randomInt(set.length)];
  }
}
