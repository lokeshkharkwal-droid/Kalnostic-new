import { IsIn } from 'class-validator';
import { ChannelOverrideStatus, MessagingChannel } from '@prisma/client';
import { FEATURE_TYPE_VALUES } from '../../template/constants/feature-types';

/** The deliverable channels an override can target (in-app IAM isn't gated here). */
const OVERRIDABLE_CHANNELS: MessagingChannel[] = [
  MessagingChannel.EMAIL,
  MessagingChannel.SMS,
  MessagingChannel.WHATSAPP,
];

/**
 * Upsert one per-(feature, channel) business override
 * (PUT /communication/channel-overrides). `status = DONT_SEND` suppresses that
 * channel for that feature; `ACTIVE` (or deleting the row) restores the default.
 * Scope (tenant + active branch) comes from the JWT, never the body.
 */
export class UpsertChannelOverrideDto {
  /** The FEATURE_TYPES key this override applies to. */
  @IsIn([...FEATURE_TYPE_VALUES])
  feature!: string;

  /** The deliverable channel being overridden (Email / SMS / WhatsApp). */
  @IsIn(OVERRIDABLE_CHANNELS)
  channel!: MessagingChannel;

  /** ACTIVE = send (default); DONT_SEND = suppress this channel for the feature. */
  @IsIn(Object.values(ChannelOverrideStatus))
  status!: ChannelOverrideStatus;
}
