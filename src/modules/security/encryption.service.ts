import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  CipherGCMTypes,
} from 'crypto';
import { InternalException } from '../../common/exceptions/kaltros.exception';

/**
 * Symmetric encryption for sensitive personal data at rest (e.g. a person's
 * Aadhaar number) — User Management v2.0, CLAUDE.md §8 security requirement.
 *
 * Algorithm: AES-256-GCM (authenticated). The 32-byte key comes from the
 * `ENCRYPTION_KEY` env var (64 hex chars). Each value uses a fresh random IV, so
 * identical plaintexts encrypt to different ciphertexts (no equality leakage —
 * which is also why encrypted columns carry no uniqueness index). The stored
 * form is `ivHex:authTagHex:cipherHex`.
 */
@Injectable()
export class EncryptionService {
  private readonly logger = new Logger(EncryptionService.name);
  private readonly algorithm: CipherGCMTypes = 'aes-256-gcm';
  private readonly ivLength = 12; // 96-bit nonce, recommended for GCM
  private readonly key: Buffer | null;

  constructor(private readonly config: ConfigService) {
    const raw = this.config.get<string>('ENCRYPTION_KEY');
    if (raw && /^[0-9a-fA-F]{64}$/.test(raw)) {
      this.key = Buffer.from(raw, 'hex');
    } else {
      this.key = null;
      if (raw) {
        this.logger.error(
          'ENCRYPTION_KEY is set but is not 64 hex characters (32 bytes); encryption is disabled.',
        );
      }
    }
  }

  /** Whether an encryption key is configured (feature is usable). */
  get isEnabled(): boolean {
    return this.key !== null;
  }

  /**
   * Encrypt a plaintext string. Returns `ivHex:authTagHex:cipherHex`.
   * @param plain the value to encrypt
   * @throws InternalException if no valid ENCRYPTION_KEY is configured
   */
  encrypt(plain: string): string {
    const key = this.requireKey();
    const iv = randomBytes(this.ivLength);
    const cipher = createCipheriv(this.algorithm, key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plain, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
  }

  /**
   * Decrypt a value produced by {@link encrypt}.
   * @param payload the stored `ivHex:authTagHex:cipherHex` string
   * @throws InternalException if the key is missing or the payload is malformed
   */
  decrypt(payload: string): string {
    const key = this.requireKey();
    const parts = payload.split(':');
    const [ivHex, tagHex, cipherHex] = parts;
    if (parts.length !== 3 || !ivHex || !tagHex || !cipherHex) {
      throw new InternalException('decrypt', { reason: 'malformed payload' });
    }
    const decipher = createDecipheriv(
      this.algorithm,
      key,
      Buffer.from(ivHex, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(cipherHex, 'hex')),
      decipher.final(),
    ]);
    return plain.toString('utf8');
  }

  private requireKey(): Buffer {
    if (!this.key) {
      throw new InternalException('encryption', {
        reason: 'ENCRYPTION_KEY is not configured (expected 64 hex chars)',
      });
    }
    return this.key;
  }
}
