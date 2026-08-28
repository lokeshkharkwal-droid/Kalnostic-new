import { ContainerType } from '@prisma/client';

/**
 * Canonical display label for each `ContainerType` enum value — the single
 * source of truth for the human-readable tube/container name. It is used to:
 *  - seed the `MasterData_TubeTypes` Collect/Print list (so every container
 *    type is a selectable tube type — see `DEFAULT_ACCESSION_SETTINGS`), and
 *  - let the frontend pre-select a sample's configured container in Collect &
 *    Print (the FE mirrors this map).
 *
 * Keep this in sync with the `ContainerType` enum in `schema.prisma` and the
 * FE mirror (`kaltros-fe/.../accession/shared/utils/format.ts`).
 */
export const CONTAINER_TYPE_LABELS: Record<ContainerType, string> = {
  EDTA_TUBE_PURPLE_TOP: 'EDTA Tube (Purple)',
  PLAIN_TUBE_RED_TOP: 'Plain Tube (Red)',
  SST_TUBE_YELLOW_TOP: 'SST (Yellow)',
  CITRATE_TUBE_BLUE_TOP: 'Citrate Tube (Blue)',
  FLUORIDE_TUBE_GREY_TOP: 'Fluoride Tube (Grey)',
  HEPARIN_TUBE_GREEN_TOP: 'Heparin Tube (Green)',
  URINE_CONTAINER: 'Urine Container',
  STOOL_CONTAINER: 'Stool Container',
  SWAB: 'Swab',
  STERILE_CONTAINER: 'Sterile Container',
  OTHER: 'Other',
};

/** Every container-type label, in enum declaration order. */
export const CONTAINER_TYPE_LABEL_LIST: string[] = Object.values(
  CONTAINER_TYPE_LABELS,
);
