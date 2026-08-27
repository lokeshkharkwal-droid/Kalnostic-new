import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BranchModule } from '../branch/branch.module';
import { TemplateModule } from '../template/template.module';
import { CommunicationController } from './communication.controller';
import { NotificationController } from './notification.controller';
import { CommunicationService } from './communication.service';
import { CommunicationWorkerService } from './communication-worker.service';
import { NotificationService } from './notification.service';
import { NotificationEventListener } from './notification-event.listener';
import { ClinicalEventListener } from './clinical-event.listener';
import { BusinessEventListener } from './business-event.listener';
import { ExchangeClient } from './exchange/exchange.client';
import { ShareService } from './services/share.service';
import { AutoNotificationService } from './services/auto-notification.service';
import { AppointmentReminderWorkerService } from './appointment-reminder-worker.service';

/**
 * Communication feature module. Tenant-scoped + branch-level — sends Email / SMS
 * / WhatsApp through the external Exchange gateway (an async queue drained by
 * `CommunicationWorkerService`) and manages in-app notifications. Imports
 * `TemplateModule` to resolve message templates and `BranchModule` to validate
 * the active scope branch, both via their exported services (CLAUDE.md rule #3 —
 * never import another service directly). Exports its services so other modules
 * can enqueue messages / raise notifications on business events.
 */
@Module({
  imports: [PrismaModule, BranchModule, TemplateModule],
  controllers: [CommunicationController, NotificationController],
  providers: [
    CommunicationService,
    CommunicationWorkerService,
    NotificationService,
    NotificationEventListener,
    ClinicalEventListener,
    BusinessEventListener,
    ExchangeClient,
    ShareService,
    AutoNotificationService,
    AppointmentReminderWorkerService,
  ],
  exports: [
    CommunicationService,
    NotificationService,
    ShareService,
    AutoNotificationService,
  ],
})
export class CommunicationModule {}
