import { Injectable } from '@nestjs/common';
import { ContactSubmission, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/response.dto';
import { CreateContactSubmissionDto } from './dto/create-contact-submission.dto';
import { ListContactSubmissionQueryDto } from './dto/list-contact-submission-query.dto';
import { ContactSubmissionListItem } from './entities/contact-submission.entity';
import { ContactSubmissionNotFoundException } from './exceptions/contact-us.exceptions';

/**
 * Contact-us submissions management. Platform-level (CLAUDE.md §4.2 — no tenant,
 * no RLS): queries use the plain Prisma client directly. Every read filters
 * soft-deleted rows (`deletedAt: null`). Rows are created by the public form and
 * reviewed/removed by SiteAdmin.
 */
@Injectable()
export class ContactUsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record a contact-us form submission (public, unauthenticated).
   * @param dto validated form payload
   * @returns the created submission
   */
  async create(dto: CreateContactSubmissionDto): Promise<ContactSubmission> {
    return this.prisma.contactSubmission.create({
      data: {
        name: dto.name,
        mobileNumber: dto.mobileNumber,
        companyName: dto.companyName,
        email: dto.email,
        message: dto.message,
      },
    });
  }

  /**
   * List contact submissions (offset pagination), newest first, projecting the
   * agreed listing columns (`companyName` → `organization`, `createdAt` →
   * `createdOn`).
   * @param query pagination + optional case-insensitive `search` (matched
   *   against `name` / `mobileNumber` / `email`) + inclusive `from`/`to`
   *   `createdAt` range
   */
  async findAll(
    query: ListContactSubmissionQueryDto,
  ): Promise<PaginatedResult<ContactSubmissionListItem>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.ContactSubmissionWhereInput = { deletedAt: null };
    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { mobileNumber: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (query.from !== undefined || query.to !== undefined) {
      where.createdAt = {
        ...(query.from !== undefined ? { gte: new Date(query.from) } : {}),
        ...(query.to !== undefined ? { lte: new Date(query.to) } : {}),
      };
    }

    const [rows, total] = await Promise.all([
      this.prisma.contactSubmission.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.contactSubmission.count({ where }),
    ]);
    return { data: rows.map(toListItem), total, page, limit };
  }

  /**
   * Fetch one active contact submission (full record).
   * @param id submission id
   * @throws ContactSubmissionNotFoundException if missing or soft-deleted
   */
  async findById(id: string): Promise<ContactSubmission> {
    const record = await this.prisma.contactSubmission.findFirst({
      where: { id, deletedAt: null },
    });
    if (!record) {
      throw new ContactSubmissionNotFoundException(id);
    }
    return record;
  }

  /**
   * Soft-delete a contact submission (sets `deletedAt`).
   * @param id submission id
   * @throws ContactSubmissionNotFoundException if missing or already soft-deleted
   */
  async remove(id: string): Promise<ContactSubmission> {
    await this.findById(id);
    return this.prisma.contactSubmission.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}

/**
 * Map a submission row to its listing shape (`organization` / `createdOn`
 * aliases).
 */
function toListItem(row: ContactSubmission): ContactSubmissionListItem {
  return {
    id: row.id,
    name: row.name,
    organization: row.companyName,
    mobileNumber: row.mobileNumber,
    email: row.email,
    message: row.message,
    createdOn: row.createdAt,
  };
}
