import {
  Machine,
  MachineAdapterLog,
  MachineBranch,
  MachineReagentKit,
  MachineTestMapping,
} from '@prisma/client';

/** Domain/response shape for a machine (the Prisma model is the DB source of truth). */
export type MachineEntity = Machine;

/**
 * A machine composed with all of its child rows + branch assignments (the
 * get-one response shape). Adapter logs are intentionally NOT embedded — they are
 * paged through their own endpoint.
 */
export type MachineWithChildren = Machine & {
  reagentKits: MachineReagentKit[];
  testMappings: MachineTestMapping[];
  branches: MachineBranch[];
};

export type {
  MachineAdapterLog,
  MachineBranch,
  MachineReagentKit,
  MachineTestMapping,
};
