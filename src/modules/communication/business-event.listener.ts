import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MessagingChannel, RecipientType } from '@prisma/client';
import {
  AutoNotificationService,
  RecipientContact,
} from './services/auto-notification.service';

/**
 * `business.registration.completed` — emitted by TenantService.create after the
 * tenant transaction commits.
 */
interface BusinessRegistrationCompletedEvent {
  tenantId: string;
  businessName: string;
  email: string | null;
  phone: string | null;
  slug: string;
  adminName: string;
}

/** `business.details.updated` — emitted by TenantService.update. */
interface BusinessDetailsUpdatedEvent {
  tenantId: string;
  businessName: string;
  email: string | null;
  phone: string | null;
}

/**
 * `business.status.suspended` / `business.status.unsuspended` — emitted by
 * TenantService.setSubscriptionStatus on the relevant status transitions.
 */
interface BusinessStatusChangedEvent {
  tenantId: string;
  businessName: string;
  email: string | null;
  phone: string | null;
}

/** Email + SMS + WhatsApp. */
const EMAIL_SMS_WHATSAPP: MessagingChannel[] = [
  MessagingChannel.EMAIL,
  MessagingChannel.SMS,
  MessagingChannel.WHATSAPP,
];

/** Email + SMS only. */
const EMAIL_SMS: MessagingChannel[] = [
  MessagingChannel.EMAIL,
  MessagingChannel.SMS,
];

/**
 * Platform/business event → notification bridge. Subscribes to the Site Admin
 * business lifecycle events (registration / details update / suspend /
 * unsuspend) and dispatches the appropriate automatic notification to the
 * business contact through {@link AutoNotificationService} (template-driven,
 * resolving the SITE_ADMIN global `Template` by feature type + channel).
 *
 * Recipients are the business's own contact (`tenant.email` / `tenant.phone`);
 * the notification is scoped to the tenant itself, so `AutoNotificationService`
 * resolves the global template via its SITE_ADMIN fallback and enqueues a
 * `CommunicationLog` row under that tenant. Purely additive and fire-and-forget:
 * dispatch swallows + logs its own errors so a messaging failure never affects
 * the already-committed Site Admin operation.
 */
@Injectable()
export class BusinessEventListener {
  constructor(private readonly auto: AutoNotificationService) {}

  /** Business registration complete → welcome the business (Email/SMS/WhatsApp). */
  @OnEvent('business.registration.completed')
  async onBusinessRegistrationCompleted(
    e: BusinessRegistrationCompletedEvent,
  ): Promise<void> {
    if (!e.email && !e.phone) return;
    await this.auto.dispatchToContact(e.tenantId, null, this.recipient(e), {
      feature: 'business_registration_complete',
      verb: 'business_registration_complete',
      subject: `Welcome to Kalnostics${e.businessName ? ` — ${e.businessName}` : ''}`,
      channels: EMAIL_SMS_WHATSAPP,
      variables: {
        business_name: e.businessName,
        admin_name: e.adminName,
      },
      fallbackHtml: (name) =>
        `<p>Dear ${name},</p><p>Your business <strong>${e.businessName}</strong> has been registered successfully. You can now sign in and start setting up your lab.</p><p>Thank you.</p>`,
    });
  }

  /** Business details updated → confirm the change (Email/SMS). */
  @OnEvent('business.details.updated')
  async onBusinessDetailsUpdated(
    e: BusinessDetailsUpdatedEvent,
  ): Promise<void> {
    if (!e.email && !e.phone) return;
    await this.auto.dispatchToContact(e.tenantId, null, this.recipient(e), {
      feature: 'business_details_update',
      verb: 'business_details_update',
      subject: 'Your business details have been updated',
      channels: EMAIL_SMS,
      variables: { business_name: e.businessName },
      fallbackHtml: (name) =>
        `<p>Dear ${name},</p><p>The profile details for your business <strong>${e.businessName}</strong> have been updated. If you did not request this change, please contact support.</p>`,
    });
  }

  /** Business suspended → inform the business (Email/SMS). */
  @OnEvent('business.status.suspended')
  async onBusinessSuspended(e: BusinessStatusChangedEvent): Promise<void> {
    if (!e.email && !e.phone) return;
    await this.auto.dispatchToContact(e.tenantId, null, this.recipient(e), {
      feature: 'business_status_suspend',
      verb: 'business_status_suspend',
      subject: 'Your business account has been suspended',
      channels: EMAIL_SMS,
      variables: { business_name: e.businessName },
      fallbackHtml: (name) =>
        `<p>Dear ${name},</p><p>Access to your business <strong>${e.businessName}</strong> has been suspended. Please contact support for assistance.</p>`,
    });
  }

  /** Business reinstated → inform the business (Email/SMS). */
  @OnEvent('business.status.unsuspended')
  async onBusinessUnsuspended(e: BusinessStatusChangedEvent): Promise<void> {
    if (!e.email && !e.phone) return;
    await this.auto.dispatchToContact(e.tenantId, null, this.recipient(e), {
      feature: 'business_status_unsuspend',
      verb: 'business_status_unsuspend',
      subject: 'Your business account has been reinstated',
      channels: EMAIL_SMS,
      variables: { business_name: e.businessName },
      fallbackHtml: (name) =>
        `<p>Dear ${name},</p><p>Access to your business <strong>${e.businessName}</strong> has been reinstated. You can sign in again as usual.</p><p>Thank you.</p>`,
    });
  }

  /** Build the business-contact recipient (Email/SMS/WhatsApp all use one contact). */
  private recipient(e: {
    businessName: string;
    email: string | null;
    phone: string | null;
  }): RecipientContact {
    return {
      recipientType: RecipientType.CUSTOM,
      name: e.businessName || 'there',
      email: e.email,
      mobile: e.phone,
      whatsappNumber: e.phone,
    };
  }
}
