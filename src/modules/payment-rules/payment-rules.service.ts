import { Injectable } from '@nestjs/common';
import { PaymentRule, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { CreatePaymentRuleDto } from './dto/create-payment-rule.dto';
import { UpdatePaymentRuleDto } from './dto/update-payment-rule.dto';
import { ListPaymentRulesQueryDto } from './dto/list-payment-rules-query.dto';
import {
  PaymentRuleCodeConflictException,
  PaymentRuleNotFoundException,
} from './exceptions/payment-rule.exceptions';

/**
 * Payment-rule management. Platform-level (SiteAdmin-managed, no tenant RLS —
 * CLAUDE.md §4.6): `tenantId`/`branchId` on a rule are optional scope references
 * set by the SiteAdmin, not isolation keys. Every query filters soft-deleted
 * rows (`deletedAt: null`); `code` is unique among active rules.
 */
@Injectable()
export class PaymentRulesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a payment rule.
   * @param dto validated payment-rule payload
   * @returns the created payment rule
   * @throws PaymentRuleCodeConflictException if another active rule uses `code`
   */
  async create(dto: CreatePaymentRuleDto): Promise<PaymentRule> {
    await this.assertCodeAvailable(dto.code);
    return this.prisma.paymentRule.create({
      data: {
        ruleType: dto.ruleType,
        name: dto.name,
        code: dto.code,
        description: dto.description ?? null,
        tenantId: dto.tenantId ?? null,
        branchId: dto.branchId ?? null,
        rank: dto.rank,
        contextType: dto.contextType ?? null,
        contextId: dto.contextId ?? null,
        class1: dto.class1 ?? null,
        class2: dto.class2 ?? null,
        calculationType: dto.calculationType,
        calculationValue: dto.calculationValue,
        taxType: dto.taxType ?? null,
        taxPercentage: dto.taxPercentage ?? null,
        effectivePeriodStartDate: dto.effectivePeriodStartDate
          ? new Date(dto.effectivePeriodStartDate)
          : null,
        effectivePeriodEndDate: dto.effectivePeriodEndDate
          ? new Date(dto.effectivePeriodEndDate)
          : null,
        isActive: dto.isActive ?? true,
      },
    });
  }

  /**
   * List payment rules, paginated, with optional search/filters.
   * @param query pagination + `name`/`code` search + `tenantId`/`ruleType`/`status` filters
   * @returns a page of matching rules (interceptor lifts totals into `meta`)
   */
  async findAll(
    query: ListPaymentRulesQueryDto,
  ): Promise<PaginatedResult<PaymentRule>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.PaymentRuleWhereInput = { deletedAt: null };

    const name = query.name?.trim();
    if (name) {
      where.name = { contains: name, mode: 'insensitive' };
    }
    const code = query.code?.trim();
    if (code) {
      where.code = { contains: code, mode: 'insensitive' };
    }
    if (query.tenantId !== undefined) {
      where.tenantId = query.tenantId;
    }
    if (query.ruleType) {
      where.ruleType = query.ruleType;
    }
    if (query.status) {
      where.isActive = query.status === 'ACTIVE';
    }

    const [data, total] = await Promise.all([
      this.prisma.paymentRule.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ rank: 'asc' }, { createdAt: 'desc' }],
      }),
      this.prisma.paymentRule.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  /**
   * Fetch one active payment rule by id.
   * @param id payment-rule id
   * @returns the payment rule
   * @throws PaymentRuleNotFoundException if missing or soft-deleted
   */
  async findById(id: string): Promise<PaymentRule> {
    const rule = await this.prisma.paymentRule.findFirst({
      where: { id, deletedAt: null },
    });
    if (!rule) {
      throw new PaymentRuleNotFoundException(id);
    }
    return rule;
  }

  /**
   * Update a payment rule. Only supplied fields are changed.
   * @param id payment-rule id
   * @param dto partial payment-rule payload
   * @returns the updated payment rule
   * @throws PaymentRuleNotFoundException if missing or soft-deleted
   * @throws PaymentRuleCodeConflictException if the new `code` is taken by
   *   another active rule
   */
  async update(id: string, dto: UpdatePaymentRuleDto): Promise<PaymentRule> {
    const existing = await this.findById(id);

    if (dto.code !== undefined && dto.code !== existing.code) {
      await this.assertCodeAvailable(dto.code, id);
    }

    return this.prisma.paymentRule.update({
      where: { id },
      data: {
        ruleType: dto.ruleType,
        name: dto.name,
        code: dto.code,
        description: dto.description,
        tenantId: dto.tenantId,
        branchId: dto.branchId,
        rank: dto.rank,
        contextType: dto.contextType,
        contextId: dto.contextId,
        class1: dto.class1,
        class2: dto.class2,
        calculationType: dto.calculationType,
        calculationValue: dto.calculationValue,
        taxType: dto.taxType,
        taxPercentage: dto.taxPercentage,
        effectivePeriodStartDate: dto.effectivePeriodStartDate
          ? new Date(dto.effectivePeriodStartDate)
          : undefined,
        effectivePeriodEndDate: dto.effectivePeriodEndDate
          ? new Date(dto.effectivePeriodEndDate)
          : undefined,
        isActive: dto.isActive,
      },
    });
  }

  /**
   * Soft-delete a payment rule (sets `deletedAt`), freeing its `code` for reuse.
   * @param id payment-rule id
   * @returns the soft-deleted payment rule
   * @throws PaymentRuleNotFoundException if missing or already soft-deleted
   */
  async remove(id: string): Promise<PaymentRule> {
    await this.findById(id);
    return this.prisma.paymentRule.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * Guard: no other active rule may share this `code`.
   * @param code the code to check
   * @param excludeId a rule id to exclude (the one being updated)
   * @throws PaymentRuleCodeConflictException if the code is already in use
   */
  private async assertCodeAvailable(
    code: string,
    excludeId?: string,
  ): Promise<void> {
    const clash = await this.prisma.paymentRule.findFirst({
      where: {
        code,
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (clash) {
      throw new PaymentRuleCodeConflictException(code);
    }
  }
}
