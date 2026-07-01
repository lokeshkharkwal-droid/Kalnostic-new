import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PaymentRulesService } from './payment-rules.service';
import { CreatePaymentRuleDto } from './dto/create-payment-rule.dto';
import { UpdatePaymentRuleDto } from './dto/update-payment-rule.dto';
import { ListPaymentRulesQueryDto } from './dto/list-payment-rules-query.dto';
import { SiteAdminPermissionGuard } from '../siteadmin/guards/siteadmin-permission.guard';
import { RequireSiteAdminPermission } from '../siteadmin/decorators/require-siteadmin-permission.decorator';
import { SITE_ADMIN_PERM } from '../siteadmin/constants/siteadmin-permissions.constant';
import { Public } from '../auth/decorators/public.decorator';

/**
 * SiteAdmin payment-rule management (`/siteadmin/payment-rules`). Payment rules
 * are platform-level (managed by SiteAdmin across all tenants; no tenant RLS).
 *
 * `@Public()` opts out of the global *business* JwtAuthGuard; auth here is the
 * SiteAdmin token validated by `SiteAdminPermissionGuard`. Reads require
 * `payment-rules:read` and writes `payment-rules:write` (full_admin and above).
 */
@Controller('siteadmin/payment-rules')
@Public()
@UseGuards(SiteAdminPermissionGuard)
export class SiteAdminPaymentRulesController {
  constructor(private readonly paymentRulesService: PaymentRulesService) {}

  /**
   * Create a payment rule.
   */
  @Post()
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.PAYMENT_RULES_WRITE)
  create(@Body() dto: CreatePaymentRuleDto) {
    return this.paymentRulesService.create(dto);
  }

  /**
   * List payment rules (paginated; search by name/code, filter by
   * tenantId/ruleType/status).
   */
  @Get()
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.PAYMENT_RULES_READ)
  findAll(@Query() query: ListPaymentRulesQueryDto) {
    return this.paymentRulesService.findAll(query);
  }

  /**
   * Fetch one payment rule by id.
   */
  @Get(':id')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.PAYMENT_RULES_READ)
  findOne(@Param('id') id: string) {
    return this.paymentRulesService.findById(id);
  }

  /**
   * Update a payment rule (only supplied fields are changed).
   */
  @Patch(':id')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.PAYMENT_RULES_WRITE)
  update(@Param('id') id: string, @Body() dto: UpdatePaymentRuleDto) {
    return this.paymentRulesService.update(id, dto);
  }

  /**
   * Soft-delete a payment rule.
   */
  @Delete(':id')
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.PAYMENT_RULES_WRITE)
  remove(@Param('id') id: string) {
    return this.paymentRulesService.remove(id);
  }
}
