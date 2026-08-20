import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { SettlementService } from './settlement.service';
import { CreateSettlementDto } from './dto/create-settlement.dto';
import { ListSettlementsDto } from './dto/list-settlements.dto';
import { SettlementSummaryQueryDto } from './dto/settlement-summary-query.dto';
import { ApproveSettlementDto } from './dto/approve-settlement.dto';
import { RejectSettlementDto } from './dto/reject-settlement.dto';
import { SettleSettlementDto } from './dto/settle-settlement.dto';
import { UpdateSettlementDto } from './dto/update-settlement.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Finance settlement endpoints. Business-authenticated; tenant comes from the JWT
 * and the branch from the active profile. Settlements are created only from selected
 * collection order records. Literal routes (`/summary`) are declared before the
 * `/:id` routes so they win.
 */
@Controller('finance/settlements')
export class SettlementController {
  constructor(private readonly settlementService: SettlementService) {}

  /** Create a settlement from selected collection order records. */
  @Post()
  @Audit({
    module: AuditModule.SETTLEMENT,
    action: AuditAction.CREATE,
    description: 'Created a settlement',
  })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Body() dto: CreateSettlementDto,
  ) {
    return this.settlementService.create(
      tenantId,
      profile.branchId,
      personId,
      dto,
    );
  }

  /** List settlements (paginated, with filters). Scoped to the active branch. */
  @Get()
  list(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: ListSettlementsDto,
  ) {
    return this.settlementService.list(tenantId, profile.branchId, query);
  }

  /** Summary-card totals over the same scoped dataset the list paginates. */
  @Get('summary')
  summary(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Query() query: SettlementSummaryQueryDto,
  ) {
    return this.settlementService.summary(tenantId, profile.branchId, query);
  }

  /** Fetch one settlement with its source orders + payout history. */
  @Get(':id')
  getOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.settlementService.getOne(id, tenantId);
  }

  /** List a settlement's payout history (newest first). */
  @Get(':id/payments')
  payments(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.settlementService.paymentHistory(id, tenantId);
  }

  /** Approve a settlement (confirm/adjust the approved amount + document it). */
  @Post(':id/approve')
  @Audit({
    module: AuditModule.SETTLEMENT,
    action: AuditAction.UPDATE,
    description: 'Approved a settlement',
  })
  approve(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: ApproveSettlementDto,
  ) {
    return this.settlementService.approve(id, tenantId, personId, dto);
  }

  /** Reject a settlement (may be edited and resubmitted). */
  @Post(':id/reject')
  @Audit({
    module: AuditModule.SETTLEMENT,
    action: AuditAction.UPDATE,
    description: 'Rejected a settlement',
  })
  reject(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: RejectSettlementDto,
  ) {
    return this.settlementService.reject(id, tenantId, personId, dto);
  }

  /** Record one payout against an approved settlement. */
  @Post(':id/settle')
  @Audit({
    module: AuditModule.SETTLEMENT,
    action: AuditAction.UPDATE,
    description: 'Recorded a settlement payout',
  })
  settle(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: SettleSettlementDto,
  ) {
    return this.settlementService.settle(
      id,
      tenantId,
      profile.branchId,
      personId,
      dto,
    );
  }

  /** Edit a settlement (changing the approved amount forces re-approval). */
  @Patch(':id')
  @Audit({
    module: AuditModule.SETTLEMENT,
    action: AuditAction.UPDATE,
    description: 'Edited a settlement',
  })
  update(
    @CurrentTenant() tenantId: string,
    @CurrentUser('person_id') personId: string,
    @Param('id') id: string,
    @Body() dto: UpdateSettlementDto,
  ) {
    return this.settlementService.update(id, tenantId, personId, dto);
  }
}
