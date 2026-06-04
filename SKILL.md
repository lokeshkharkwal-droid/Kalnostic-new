# SKILL.md — Reusable Patterns & Templates

> Copy-paste-friendly templates for **Kalnostics New**. Every pattern here
> encodes the rules from `CLAUDE.md`. When you build something new, start from
> the relevant template — don't reinvent it.
>
> Audience: a junior NestJS developer. Code is commented on purpose.

---

## Table of Contents

1. [Standard module scaffold](#1-standard-module-scaffold)
2. [Standard Prisma model template](#2-standard-prisma-model-template)
3. [Standard service CRUD template](#3-standard-service-crud-template)
4. [Standard DTO templates](#4-standard-dto-templates)
5. [Standard error handling pattern](#5-standard-error-handling-pattern)
6. [Standard pagination (cursor-based)](#6-standard-pagination-cursor-based)
7. [Environment config pattern](#7-environment-config-pattern)
8. [JWT auth guard pattern](#8-jwt-auth-guard-pattern)
9. [How to add a new feature (checklist)](#9-how-to-add-a-new-feature-checklist)

---

## 1. Standard module scaffold

Every feature lives under `src/modules/<feature>/` and has **exactly** this
shape (rule #1 in `CLAUDE.md`):

```
src/modules/course/
├── course.module.ts          # wires controller + service + imports
├── course.controller.ts      # HTTP layer ONLY — no business logic
├── course.service.ts         # business logic + Prisma calls
├── dto/
│   ├── create-course.dto.ts   # input shape for create (class-validator)
│   ├── update-course.dto.ts   # input shape for update (PartialType)
│   └── course-response.dto.ts # output shape (what the API returns)
└── entities/
    └── course.entity.ts       # domain/type representation of the model
```

### `course.module.ts`

```ts
import { Module } from '@nestjs/common';
import { CourseController } from './course.controller';
import { CourseService } from './course.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  // Import OTHER modules to get access to their exported providers.
  // This is how a service gets another service WITHOUT importing it
  // directly (CLAUDE.md rule #3).
  imports: [PrismaModule],
  controllers: [CourseController],
  providers: [CourseService],
  // Export the service if another module needs to inject it.
  exports: [CourseService],
})
export class CourseModule {}
```

### `course.controller.ts`

```ts
import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { CourseService } from './course.service';
import { CreateCourseDto } from './dto/create-course.dto';
import { CourseResponseDto } from './dto/course-response.dto';
import { ResponseDto } from '../../common/dto/response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

@Controller('courses')
export class CourseController {
  constructor(private readonly courseService: CourseService) {}

  /**
   * Create a new course.
   * @param dto validated course creation payload
   * @returns the created course wrapped in the standard response envelope
   */
  @Post()
  async create(
    @Body() dto: CreateCourseDto,
  ): Promise<ResponseDto<CourseResponseDto>> {
    const course = await this.courseService.create(dto);
    return ResponseDto.ok(course);
  }

  /**
   * List courses with cursor-based pagination.
   * @param query cursor + limit query params
   * @returns a page of courses plus the next cursor
   */
  @Get()
  async findMany(@Query() query: PaginationQueryDto) {
    return this.courseService.findMany(query);
  }

  /**
   * Fetch a single course by id.
   * @param id course id
   * @returns the course, or 404 if it does not exist
   */
  @Get(':id')
  async findOne(
    @Param('id') id: string,
  ): Promise<ResponseDto<CourseResponseDto>> {
    const course = await this.courseService.findOne(id);
    return ResponseDto.ok(course);
  }
}
```

> The controller is *thin*: it parses input, calls the service, wraps the
> result. All real logic lives in the service.

---

## 2. Standard Prisma model template

Every model gets `createdAt`, `updatedAt`, and a **soft-delete** flag
(`deletedAt`). We never hard-delete user data by default.

Note the mappings: model is `PascalCase` singular, table is `snake_case`
plural, columns are `snake_case` (CLAUDE.md §3).

```prisma
// prisma/schema.prisma

model Course {
  // --- primary key ---
  id        String   @id @default(uuid())

  // --- domain fields ---
  title     String
  slug      String   @unique
  isPublished Boolean @default(false) @map("is_published")

  // --- audit timestamps (standard on EVERY model) ---
  createdAt DateTime @default(now())      @map("created_at")
  updatedAt DateTime @updatedAt           @map("updated_at")

  // --- soft delete (standard on EVERY model) ---
  // NULL  = active row
  // set   = "deleted" at this timestamp (we filter these out in queries)
  deletedAt DateTime? @map("deleted_at")

  // model name = PascalCase singular  →  table name = snake_case plural
  @@map("courses")
  // helpful index for the common "active rows only" query
  @@index([deletedAt])
}
```

**Soft-delete rule:** every `findMany`/`findOne` must add
`where: { deletedAt: null }` so deleted rows never leak. Deleting = setting
`deletedAt` to "now", not calling `prisma.course.delete()`.

---

## 3. Standard service CRUD template

The service holds business logic and is the *only* place Prisma is called.

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCourseDto } from './dto/create-course.dto';
import { UpdateCourseDto } from './dto/update-course.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

@Injectable()
export class CourseService {
  // PrismaService comes in via DI because PrismaModule is imported
  // in CourseModule. No direct service-to-service imports (rule #3).
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new course.
   * @param dto validated creation payload
   * @returns the newly created course
   */
  async create(dto: CreateCourseDto) {
    return this.prisma.course.create({ data: dto });
  }

  /**
   * Return a single, non-deleted course by id.
   * @param id course id
   * @throws NotFoundException if no active course matches
   * @returns the course record
   */
  async findOne(id: string) {
    const course = await this.prisma.course.findFirst({
      where: { id, deletedAt: null }, // soft-delete filter (always!)
    });
    if (!course) {
      throw new NotFoundException(`Course ${id} not found`);
    }
    return course;
  }

  /**
   * Update a course after confirming it exists.
   * @param id course id
   * @param dto partial update payload
   * @returns the updated course
   */
  async update(id: string, dto: UpdateCourseDto) {
    await this.findOne(id); // reuse the 404 logic
    return this.prisma.course.update({ where: { id }, data: dto });
  }

  /**
   * Soft-delete a course (sets deletedAt; row is kept in the DB).
   * @param id course id
   * @returns the soft-deleted course
   */
  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.course.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * List active courses using cursor-based pagination.
   * @param query cursor + limit
   * @returns a page of courses + the cursor for the next page
   */
  async findMany(query: PaginationQueryDto) {
    // see §6 for the full pagination pattern
    const limit = query.limit ?? 20;
    const items = await this.prisma.course.findMany({
      where: { deletedAt: null },
      take: limit + 1, // fetch one extra to detect "has next page"
      ...(query.cursor && {
        cursor: { id: query.cursor },
        skip: 1, // skip the cursor row itself
      }),
      orderBy: { createdAt: 'desc' },
    });

    const hasNext = items.length > limit;
    const page = hasNext ? items.slice(0, limit) : items;
    const nextCursor = hasNext ? page[page.length - 1].id : null;

    return { items: page, nextCursor };
  }
}
```

---

## 4. Standard DTO templates

DTOs validate with `class-validator` decorators only (CLAUDE.md rule #2).

### `create-course.dto.ts`

```ts
import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateCourseDto {
  @IsString()
  @MinLength(3)
  title: string;

  @IsString()
  @MinLength(3)
  slug: string;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}
```

### `update-course.dto.ts`

```ts
import { PartialType } from '@nestjs/mapped-types';
import { CreateCourseDto } from './create-course.dto';

// PartialType makes every field from CreateCourseDto optional,
// while keeping all the validation rules. No copy-pasting fields.
export class UpdateCourseDto extends PartialType(CreateCourseDto) {}
```

### `course-response.dto.ts`

```ts
// The shape we expose to clients. Keep it explicit so we never
// accidentally leak internal-only fields (e.g. deletedAt).
export class CourseResponseDto {
  id: string;
  title: string;
  slug: string;
  isPublished: boolean;
  createdAt: Date;
  updatedAt: Date;
}
```

### `response.dto.ts` (the shared wrapper — lives in `src/common/dto/`)

Every controller returns this (CLAUDE.md rule #7).

```ts
/**
 * Standard API response envelope. ALL controller responses use this so the
 * frontend always sees the same shape: { success, data, message }.
 */
export class ResponseDto<T> {
  success: boolean;
  data: T;
  message: string;

  private constructor(success: boolean, data: T, message: string) {
    this.success = success;
    this.data = data;
    this.message = message;
  }

  /** Build a successful response. */
  static ok<T>(data: T, message = 'OK'): ResponseDto<T> {
    return new ResponseDto<T>(true, data, message);
  }
}
```

---

## 5. Standard error handling pattern

Throw NestJS built-in `HttpException` subclasses (CLAUDE.md rule #6). NestJS
turns them into the right HTTP status + JSON automatically.

```ts
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';

// 404 — resource doesn't exist
throw new NotFoundException(`Course ${id} not found`);

// 400 — caller sent something invalid that decorators couldn't catch
throw new BadRequestException('startDate must be before endDate');

// 409 — uniqueness / state conflict
throw new ConflictException('A course with this slug already exists');

// 401 — not authenticated
throw new UnauthorizedException('Invalid credentials');

// 403 — authenticated but not allowed
throw new ForbiddenException('You cannot edit this course');
```

**Never** do `throw new Error('...')` in a request path — it becomes an opaque
500 with no useful status.

> Common mapping: `404 NotFound`, `400 BadRequest`, `401 Unauthorized`,
> `403 Forbidden`, `409 Conflict`, `422 UnprocessableEntity`.

---

## 6. Standard pagination (cursor-based)

We use **cursor-based** pagination (stable under inserts, scales better than
offset). The cursor is the `id` of the last item on the current page.

### Shared query DTO — `src/common/dto/pagination-query.dto.ts`

```ts
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class PaginationQueryDto {
  /** id of the last item from the previous page (omit for first page). */
  @IsOptional()
  @IsString()
  cursor?: string;

  /** page size (default 20, hard cap 100). */
  @IsOptional()
  @Type(() => Number) // query params arrive as strings; coerce to number
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
```

### Usage in a service (the "fetch one extra" trick)

```ts
const limit = query.limit ?? 20;

const rows = await this.prisma.course.findMany({
  where: { deletedAt: null },
  take: limit + 1,                       // +1 tells us if there's a next page
  ...(query.cursor && {
    cursor: { id: query.cursor },
    skip: 1,                             // don't return the cursor row again
  }),
  orderBy: { createdAt: 'desc' },        // deterministic order is required
});

const hasNext = rows.length > limit;
const items = hasNext ? rows.slice(0, limit) : rows;
const nextCursor = hasNext ? items[items.length - 1].id : null;

return { items, nextCursor };            // wrap with ResponseDto.ok(...) in controller
```

**Why `+1`?** We ask for one more row than the page size. If we get it back,
we know there's a next page — then we drop it before returning.

---

## 7. Environment config pattern

Use `@nestjs/config` with a **Joi** validation schema so the app refuses to
boot with a bad/missing env var.

### `src/config/env.validation.ts`

```ts
import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().default(3000),
  DATABASE_URL: Joi.string().uri().required(),
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRES_IN: Joi.string().default('1h'),
});
```

### Register it in `app.module.ts`

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { envValidationSchema } from './config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,                    // ConfigService available everywhere
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: false }, // report ALL bad vars at once
    }),
    // ...feature modules
  ],
})
export class AppModule {}
```

### Reading a value

```ts
constructor(private readonly config: ConfigService) {}

const secret = this.config.getOrThrow<string>('JWT_SECRET');
```

### `.env.example` (committed; document every var)

```
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://user:pass@localhost:5432/kalnostics
JWT_SECRET=replace-with-a-long-random-string-min-32-chars
JWT_EXPIRES_IN=1h
```

> `.env` (real secrets) is **git-ignored**. `.env.example` (no secrets) is
> committed so teammates know what to set.

---

## 8. JWT auth guard pattern

A guard protects routes by validating the `Authorization: Bearer <token>`
header.

### `src/common/guards/jwt-auth.guard.ts`

```ts
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Allow the request only if it carries a valid Bearer JWT.
   * On success, attaches the decoded payload to req.user.
   * @throws UnauthorizedException when the token is missing or invalid
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(req);
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }
    try {
      const payload = await this.jwt.verifyAsync(token, {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
      });
      // make the user available to controllers via @CurrentUser()
      (req as Request & { user: unknown }).user = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  /** Pull the raw token out of the Authorization header. */
  private extractToken(req: Request): string | undefined {
    const [type, token] = req.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
```

### `@CurrentUser()` decorator — `src/common/decorators/current-user.decorator.ts`

```ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** Inject the authenticated user (set by JwtAuthGuard) into a handler param. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    return ctx.switchToHttp().getRequest().user;
  },
);
```

### Protecting a route

```ts
@UseGuards(JwtAuthGuard)
@Get('me')
getProfile(@CurrentUser() user: { sub: string }) {
  return this.userService.findOne(user.sub);
}
```

> `JwtModule` and `ConfigModule` must be imported in the module that uses the
> guard so DI can supply `JwtService` and `ConfigService`.

---

## 9. How to add a new feature (checklist)

Follow this top to bottom every time. Example feature: `lesson`.

- [ ] **1. Model** — add the Prisma model in `prisma/schema.prisma` using the
      §2 template (include `createdAt`, `updatedAt`, `deletedAt`, `@@map`).
- [ ] **2. Migrate** — run `npx prisma migrate dev --name add_lesson` and
      commit the generated migration.
- [ ] **3. Folder** — create `src/modules/lesson/` with the §1 scaffold
      (`module / controller / service / dto / entities`).
- [ ] **4. DTOs** — write `create-lesson.dto.ts` (class-validator),
      `update-lesson.dto.ts` (`PartialType`), `lesson-response.dto.ts` (§4).
- [ ] **5. Service** — implement CRUD from the §3 template. Always filter
      `deletedAt: null`. Soft-delete instead of hard delete.
- [ ] **6. Controller** — thin HTTP layer; wrap every response in
      `ResponseDto.ok(...)` (§4). Add `@UseGuards(JwtAuthGuard)` where needed.
- [ ] **7. Module wiring** — `imports: [PrismaModule, ...]`, declare the
      controller + service, `exports` the service if other modules need it.
      Never import another service file directly (rule #3).
- [ ] **8. Register** — add `LessonModule` to `AppModule.imports`.
- [ ] **9. Pagination** — list endpoints use the cursor pattern from §6.
- [ ] **10. JSDoc** — every public method documented (rule #5).
- [ ] **11. Errors** — use built-in `HttpException` subclasses (rule #6).
- [ ] **12. Test** — add/adjust tests; run the suite.
- [ ] **13. Commit** — Conventional Commits, e.g.
      `feat(lesson): add lesson CRUD with cursor pagination`.

> If any step makes you want to break a rule in `CLAUDE.md`, stop and raise it
> in review instead of working around it.
