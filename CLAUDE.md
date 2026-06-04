# CLAUDE.md — AI Working Memory

> This file is the single source of truth for how we build **Kalnostics New**.
> Read it before writing any code. If a rule here conflicts with something you
> see elsewhere, **this file wins** — and flag the conflict.

---

## 1. Project Overview

| Item            | Value                                             |
| --------------- | ------------------------------------------------- |
| **Project name** | Kalnostics New                                   |
| **Type**         | LMS (Laboratory Management System) backend         |
| **Runtime**      | Node.js (LTS)                                     |

### Tech Stack

- **NestJS** — application framework (modules, controllers, services, DI)
- **Prisma ORM** — database access layer (the *only* way we touch the DB)
- **PostgreSQL** — relational database
- **TypeScript** — `strict` mode is **on** and non-negotiable

> ⚠️ TypeScript strict mode means: no implicit `any`, strict null checks,
> no unchecked index access. Type everything. If you reach for `any`, stop
> and find the real type.

---

## 2. Code Style Rules

These are hard rules. "No exceptions" means no exceptions — if you think you
found one, raise it in review instead of breaking the rule silently.

1. **Module layout is fixed.** Every feature module follows the same shape:
   `module / controller / service / dto / entity`. (See `SKILL.md` for the
   exact scaffold.) No flat files, no "I'll just put it here for now."

2. **DTOs validate with `class-validator` decorators only.** Never hand-roll
   `if (!body.email) throw ...` validation inside a controller or service.
   The validation pipe + decorators do that job.

3. **Services never import other services directly.** If `CourseService`
   needs `UserService`, wire it through the **module's `imports`/`providers`**
   and inject it via the constructor. Never `import { UserService }` and `new`
   it, and never reach across modules with a direct file import.

4. **No raw SQL.** Use the Prisma client for everything. No
   `prisma.$queryRaw`, no string-built queries. If Prisma can't express it,
   raise it for discussion before writing raw SQL.

5. **Every public method has a JSDoc comment.** Explain *what* it does, its
   params, and what it returns/throws. Private helpers are encouraged to have
   them too, but public is mandatory.

6. **Errors use NestJS built-in `HttpException` classes.** Use
   `NotFoundException`, `BadRequestException`, `UnauthorizedException`,
   `ConflictException`, etc. Don't `throw new Error('...')` in request paths.

7. **All responses use the shared `ResponseDto` wrapper.** Controllers never
   return a bare entity or array — they return a `ResponseDto<T>`. This keeps
   the API shape consistent for frontend consumers. (Template in `SKILL.md`.)

---

## 3. Naming Conventions

| Thing                | Convention            | Example                       |
| -------------------- | --------------------- | ----------------------------- |
| **Files**            | `kebab-case`          | `user-profile.service.ts`     |
| **Classes**          | `PascalCase`          | `UserProfileService`          |
| **Variables / fns**  | `camelCase`           | `findActiveUsers`             |
| **Database tables**  | `snake_case`, plural  | `user_profiles`               |
| **Prisma models**    | `PascalCase`, singular | `UserProfile`                |

> Prisma model → table mapping is done with `@@map("user_profiles")` and
> field mapping with `@map("created_at")`. See the Prisma template in
> `SKILL.md`. This lets us keep idiomatic Prisma model names *and* idiomatic
> SQL table names at the same time.

---

## 4. Folder Structure (overview)

This is the high-level layout. The detailed per-module scaffold lives in
`SKILL.md` and gets expanded in **Phase 2**.

```
kalnostics-new/
├── prisma/
│   ├── schema.prisma          # Prisma schema (models, datasource, generator)
│   └── migrations/            # generated migration history (committed)
├── src/
│   ├── main.ts                # app bootstrap (global pipes, prefix, etc.)
│   ├── app.module.ts          # root module — imports all feature modules
│   ├── common/                # cross-cutting, shared-by-everyone code
│   │   ├── dto/               # ResponseDto, PaginationDto, etc.
│   │   ├── guards/            # JwtAuthGuard, RolesGuard
│   │   ├── decorators/        # @CurrentUser(), @Public(), etc.
│   │   ├── filters/           # global exception filter (optional)
│   │   └── interceptors/      # response/transform interceptors (optional)
│   ├── config/                # @nestjs/config setup + Joi validation schema
│   ├── prisma/                # PrismaModule + PrismaService (DB client)
│   └── modules/               # ⬅️ ALL feature modules live here
│       └── <feature>/         # one folder per feature (see SKILL.md scaffold)
├── test/                      # e2e tests
├── .env                       # local secrets (NOT committed)
├── .env.example               # documented env template (committed)
├── CLAUDE.md                  # ← you are here
└── SKILL.md                   # reusable patterns & templates
```

> **Phase 2 note:** the `modules/` tree will be filled out feature by feature
> (auth, users, courses, enrollments, lessons, …). Each one uses the exact
> scaffold from `SKILL.md` — no improvising.

---

## 5. Git Commit Convention

We use **[Conventional Commits](https://www.conventionalcommits.org/)**.

```
<type>(<optional scope>): <short summary in present tense>
```

**Allowed types:**

| Type       | Use for                                                |
| ---------- | ------------------------------------------------------ |
| `feat`     | a new feature                                          |
| `fix`      | a bug fix                                              |
| `chore`    | tooling, deps, config — no production code change      |
| `docs`     | documentation only                                     |
| `refactor` | code change that neither fixes a bug nor adds a feature |

**Examples**

```
feat(courses): add cursor-based pagination to list endpoint
fix(auth): reject expired JWTs with 401 instead of 500
chore: bump prisma to 5.x
docs: document env vars in .env.example
refactor(users): extract password hashing into a helper
```

Rules of thumb:
- Summary line ≤ ~72 chars, lower-case, no trailing period.
- One logical change per commit.
- Body (optional) explains *why*, not *what* — the diff shows the *what*.

---

## 6. Working Agreement (for the AI)

- Before adding a feature, re-read the **"How to add a new feature"**
  checklist in `SKILL.md` and follow it top to bottom.
- Reuse the templates in `SKILL.md`. Don't invent a second way to do a thing
  that already has a pattern.
- When unsure, prefer the boring, consistent choice over the clever one.
- Keep `CLAUDE.md` and `SKILL.md` up to date when conventions change.
