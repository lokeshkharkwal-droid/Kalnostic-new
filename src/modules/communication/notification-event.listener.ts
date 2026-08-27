import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationKind } from '@prisma/client';
import { NotificationService, ActorIdentity } from './notification.service';

/** Payload of `users.user.created` (see UsersService.create). */
interface UserCreatedEvent {
  personId: string;
  tenantId: string;
  userCode?: string;
  createdBy?: string | null;
}

/** Payload of `users.user.status.changed` (see UsersService.setStatus). */
interface UserStatusChangedEvent {
  tenantId: string;
  personId: string;
  status: string;
  actorId?: string | null;
}

/** Payload of `users.branch.assignment.updated` (see UsersService branch assignment). */
interface BranchAssignmentUpdatedEvent {
  tenantId: string;
  personId: string;
  branchId: string;
  actorId?: string | null;
}

/**
 * Turns existing domain events into in-app notifications for the affected staff
 * user (the notification bell). Purely additive — it subscribes to events the
 * user/identity flows ALREADY emit, so no producer code changes. Every handler
 * is fire-and-forget: a notification failure is logged and swallowed so it never
 * breaks the (already-committed) business operation. `NotificationService.create`
 * runs inside `withTenant`, so these out-of-request handlers set the RLS tenant
 * GUC correctly.
 */
@Injectable()
export class NotificationEventListener {
  private readonly logger = new Logger(NotificationEventListener.name);

  constructor(private readonly notifications: NotificationService) {}

  /** Welcome the newly-created staff user with an in-app message. */
  @OnEvent('users.user.created')
  async onUserCreated(e: UserCreatedEvent): Promise<void> {
    await this.raise(
      e.tenantId,
      null,
      NotificationKind.MESSAGE,
      'account_created',
      'Welcome to Kalnostics',
      e.userCode
        ? `Your staff account (${e.userCode}) has been created.`
        : 'Your staff account has been created.',
      { entityId: e.personId, entityType: 'STAFF' },
      { entityId: e.createdBy ?? e.personId, entityType: 'STAFF' },
    );
  }

  /** Alert a staff user when their account status changes. */
  @OnEvent('users.user.status.changed')
  async onStatusChanged(e: UserStatusChangedEvent): Promise<void> {
    await this.raise(
      e.tenantId,
      null,
      NotificationKind.ALERT,
      'account_status_changed',
      'Account status updated',
      `Your account status is now ${e.status}.`,
      { entityId: e.personId, entityType: 'STAFF' },
      { entityId: e.actorId ?? e.personId, entityType: 'STAFF' },
    );
  }

  /** Alert a staff user when their branch assignment changes. */
  @OnEvent('users.branch.assignment.updated')
  async onBranchAssignmentUpdated(
    e: BranchAssignmentUpdatedEvent,
  ): Promise<void> {
    await this.raise(
      e.tenantId,
      e.branchId,
      NotificationKind.ALERT,
      'branch_assignment_updated',
      'Branch assignment updated',
      'Your branch assignment has been updated.',
      { entityId: e.personId, entityType: 'STAFF' },
      { entityId: e.actorId ?? e.personId, entityType: 'STAFF' },
    );
  }

  /**
   * Create a single-target in-app notification, swallowing (logging) any error.
   * @param tenantId tenant scope
   * @param branchId branch scope (null for tenant-level)
   * @param kind MESSAGE or ALERT
   * @param verb machine action verb
   * @param subject notification title
   * @param body notification body
   * @param target the recipient staff person
   * @param actor the acting person (sender)
   */
  private async raise(
    tenantId: string,
    branchId: string | null,
    kind: NotificationKind,
    verb: string,
    subject: string,
    body: string,
    target: { entityId: string; entityType: string },
    actor: ActorIdentity,
  ): Promise<void> {
    try {
      await this.notifications.create(
        tenantId,
        branchId,
        { kind, verb, subject, body, targets: [target] },
        actor,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Failed to raise in-app notification (${verb}) for ${target.entityId}: ${message}`,
      );
    }
  }
}
