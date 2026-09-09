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

  URINE_24H_CONTAINER_NO_PRESERVATIVE:
    '24-Hour Urine Container (No Preservative)',
  URINE_24H_CONTAINER_ACETIC_ACID:
    '24-Hour Urine Container with 50% Acetic Acid',
  URINE_24H_CONTAINER_HYDROCHLORIC_ACID:
    '24-Hour Urine Container with 6M Hydrochloric Acid',
  URINE_24H_CONTAINER_BORIC_ACID: '24-Hour Urine Container with Boric Acid',
  URINE_24H_CONTAINER_DIAZOLIDINYL_UREA:
    '24-Hour Urine Container with Diazolidinyl Urea (Germall)',
  URINE_24H_CONTAINER_SODIUM_CARBONATE:
    '24-Hour Urine Container with Sodium Carbonate',
  ANAEROBIC_TRANSPORT_VIAL: 'Anaerobic Transport Vial',
  BLOOD_CULTURE_BOTTLE_AEROBIC: 'Blood Culture Bottle (Aerobic)',
  BLOOD_CULTURE_BOTTLE_ANAEROBIC: 'Blood Culture Bottle (Anaerobic)',
  BLOOD_CULTURE_BOTTLE_PEDIATRIC: 'Blood Culture Bottle (Pediatric)',
  CLEAN_PAPER_ENVELOPE_PACKET: 'Clean Paper Envelope / Packet',
  CULTURE_PLATE_BROTH_VIAL: 'Culture Plate / Broth Vial',
  GLASS_SLIDES_WITH_FIXATIVE_SLIDE_JAR:
    'Glass Slides with Fixative / Slide Jar',
  K2_K3_EDTA_TUBE_LAVENDER_TOP: 'K2 / K3 EDTA Tube (Lavender Top)',
  LIQUID_BASED_CYTOLOGY_VIAL: 'Liquid-Based Cytology Vial',
  LITHIUM_HEPARIN_TUBE_GREEN_TOP: 'Lithium Heparin Tube (Green Top)',
  PLAIN_CLOT_ACTIVATOR_TUBE_RED_TOP: 'Plain / Clot Activator Tube (Red Top)',
  PPT_PLASMA_PREP_TUBE_PEARL_WHITE_TOP:
    'PPT (Plasma Preparation Tube - Pearl White Top)',
  ROYAL_BLUE_TRACE_ELEMENT_TUBE: 'Royal Blue Trace Element Tube',
  SST_TUBE_WITH_GEL_GOLD_TOP: 'Serum Separator Tube / SST with Gel (Gold Top)',
  SODIUM_CITRATE_TUBE_32PCT_LIGHT_BLUE_TOP:
    'Sodium Citrate Tube 3.2% (Light Blue Top)',
  SODIUM_CITRATE_TUBE_38PCT_ESR_BLACK_TOP:
    'Sodium Citrate Tube 3.8% for ESR (Black Top)',
  SODIUM_FLUORIDE_OXALATE_TUBE_GREY_TOP:
    'Sodium Fluoride / Potassium Oxalate Tube (Grey Top)',
  SODIUM_HEPARIN_TUBE_GREEN_TOP: 'Sodium Heparin Tube (Green Top)',
  STERILE_CONTAINER_NEUTRAL_BUFFERED_FORMALIN:
    'Sterile Container with 10% Neutral Buffered Formalin',
  STERILE_CONTAINER_GLUTARALDEHYDE:
    'Sterile Container with 2.5% Glutaraldehyde',
  STERILE_CONTAINER_CARY_BLAIR_MEDIUM:
    'Sterile Container with Cary-Blair Transport Medium',
  STERILE_CONTAINER_MICHELS_ZEUS_MEDIUM:
    "Sterile Container with Michel's / ZEUS Transport Medium",
  STERILE_CONTAINER_NORMAL_SALINE_FRESH:
    'Sterile Container with Normal Saline / Fresh',
  STERILE_DRY_SWAB_CONTAINER: 'Sterile Dry Swab Container (No Preservative)',
  STERILE_UNIVERSAL_WIDE_MOUTH_CONTAINER:
    'Sterile Universal Wide-Mouth Container',
  SWEAT_COLLECTION_DEVICE_MACRODUCT: 'Sweat Collection Device (Macroduct)',
  SWAB_TUBE_AMIES_STUART_MEDIUM:
    'Swab Tube with Transport Medium (Amies / Stuart)',
  SWAB_TUBE_VIRAL_TRANSPORT_MEDIUM:
    'Swab Tube with Viral Transport Medium (VTM)',
  WHATMAN_903_FILTER_PAPER_CARD: 'Whatman 903 Filter Paper Card',
};

/** Every container-type label, in enum declaration order. */
export const CONTAINER_TYPE_LABEL_LIST: string[] = Object.values(
  CONTAINER_TYPE_LABELS,
);
