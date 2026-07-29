import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  Put,
} from '@nestjs/common';
import {
  AuditAction,
  AuditModule,
  RegistrationIdSequenceType,
} from '@prisma/client';
import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { RegistrationIdSequenceService } from './registration-id-sequence.service';
import { SaveRegistrationIdSequenceDto } from './dto/save-registration-id-sequence.dto';

/**
 * Registration ID-sequence endpoints — Order/Quotation/Appointment/
 * Patient-UMID external-id generation config (prefix/separator/suffix/number
 * length/reset cycle + a live preview). Business-authenticated; tenant from
 * the JWT, branch from the active profile. Minting a real id
 * (`RegistrationIdSequenceService.generateNext`) is not exposed here — it's a
 * side effect of the actual order/quotation/appointment/patient creation
 * flows.
 */
@Controller('registration-settings/id-sequences')
export class RegistrationIdSequenceController {
  constructor(
    private readonly idSequenceService: RegistrationIdSequenceService,
  ) {}

  /** Select/list enum values for the frontend controls. */
  @Get('enums')
  getEnums() {
    return this.idSequenceService.getEnums();
  }

  /** All 4 sequence configs (+ live preview) for the active branch. */
  @Get()
  getSequences(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
  ) {
    return this.idSequenceService.getForBranch(
      tenantId,
      profile.branchId ?? '',
    );
  }

  /** Save (partial patch) one sequence type's config for the active branch. */
  @Put(':sequenceType')
  @Audit({
    module: AuditModule.REGISTRATION_SETTINGS,
    action: AuditAction.UPDATE,
    description: 'Updated registration ID sequence settings',
  })
  saveSequence(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Param('sequenceType', new ParseEnumPipe(RegistrationIdSequenceType))
    sequenceType: RegistrationIdSequenceType,
    @Body() dto: SaveRegistrationIdSequenceDto,
  ) {
    return this.idSequenceService.saveForBranch(
      tenantId,
      profile.branchId ?? '',
      sequenceType,
      dto,
    );
  }
}
