import { IsArray, IsIn, IsObject, IsOptional } from 'class-validator';
import { MessagingChannel } from '@prisma/client';

/** Deliverable channels a patient may opt out of (in-app IAM is never suppressed). */
const OPT_OUTABLE_CHANNELS: MessagingChannel[] = [
  MessagingChannel.EMAIL,
  MessagingChannel.SMS,
  MessagingChannel.WHATSAPP,
];

/**
 * Set a patient's notification opt-out (PUT /patients/:id/notification-preferences).
 * `optOutChannels` suppress a channel for every feature; `optOutFeatures` suppress
 * it only for the given FEATURE_TYPES keys. Both are replaced wholesale (a full
 * write of the patient's preferences). Unknown feature keys / channels in
 * `optOutFeatures` are sanitised server-side. Absent fields clear that dimension.
 */
export class UpdatePatientNotificationPreferencesDto {
  /** Channels the patient opts out of across all features. */
  @IsOptional()
  @IsArray()
  @IsIn(OPT_OUTABLE_CHANNELS, { each: true })
  optOutChannels?: MessagingChannel[];

  /**
   * Per-feature opt-out map: `{ [FEATURE_TYPES key]: MessagingChannel[] }`.
   * Validated/sanitised in the service (keys must be known features; values must
   * be deliverable channels).
   */
  @IsOptional()
  @IsObject()
  optOutFeatures?: Record<string, MessagingChannel[]>;
}
