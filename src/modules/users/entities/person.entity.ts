import { Person } from '@prisma/client';

/** Domain/response shape for a person (Prisma model is the DB source of truth). */
export type PersonEntity = Person;
