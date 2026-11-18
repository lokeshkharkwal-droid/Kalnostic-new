import type {
  LabReportStatus,
  SampleStatus,
  TransferStatus,
} from '@prisma/client';
import type { SearchMenu } from '../constants/sample-search-actions.constant';

/** A date and an optional "HH:mm" time, as a transfer stores them. */
export interface SearchDateTime {
  date: string | null;
  time: string | null;
}

/** One test line of a section: one sample row holds one test. */
export interface SearchSampleRow {
  sampleId: string;
  /** The transfer of this row (Internal / External Referral only). */
  transferId: string | null;
  testName: string;
  department: string | null;
  category: string | null;
  subcategory: string | null;
  /** The report of this test, `null` when it has none (yet). */
  reportStatus: LabReportStatus | null;
  /** The test was removed from the order (the sample is kept but frozen). */
  itemRemoved: boolean;
  /** Discarded rows only: whether THIS row is marked recoverable; `null` for a row in another status. */
  recoverable: boolean | null;
  /** Returned rows only: whether THIS row is confirmed physically back and verified; `null` for a row in another status. */
  returnedVerified: boolean | null;
}

/**
 * The rows of one barcode that are in the same status: In-House sections follow the sample status,
 * Internal / External Referral sections follow the transfer status. Usually there is one section.
 */
export interface SearchSection {
  kind: 'SAMPLE' | 'TRANSFER';
  /** Sample status (In-House) or transfer status (Internal / External Referral). */
  status: SampleStatus | TransferStatus;
  sampleType: string | null;
  container: string | null;
  sampleIds: string[];
  transferIds: string[];
  rows: SearchSampleRow[];
  /**
   * The buttons to show, in the document's order, already narrowed by what the server would allow.
   * The user's own permissions are applied by the screen.
   */
  actions: string[];
  /** Why a button the document lists is missing (e.g. Store: tests not published), for a tooltip. */
  hiddenActionReasons: Record<string, string>;
  /** The Discard / Return flags (In-House only). */
  flags: {
    /** `null` unless every row is Discarded: whether they are all marked recoverable. */
    recoverable: boolean | null;
    /** `null` unless every row is Returned: whether they are all verified. */
    returnedVerified: boolean | null;
    /**
     * The rows of this section do not all carry the same value of the flag that belongs to its status (a Discarded
     * section with both recoverable and not-recoverable rows, a Returned section with verified and unverified rows).
     * The per-row values are on `rows`; `recoverable` / `returnedVerified` above then only say "every row".
     */
    mixed: boolean;
  };
  /** The order is cancelled: the samples are frozen. */
  orderCancelled: boolean;
  /**
   * The test of every row in this section was removed from the order: the sample is kept but frozen (only
   * Store stays open). Such rows are never mixed with the live rows of the same status.
   */
  itemRemoved: boolean;
  /**
   * The barcode the scanned code stands for when a Repeat took it off these samples and they wait for a new tube
   * (they have no barcode now); `null` for samples that carry the barcode. The screen says so in a note.
   */
  barcodeTakenOff: string | null;
}

/** What the popup shows besides the order itself (the screen loads the order with `GET /orders/:id`). */
export interface SearchFields {
  /** Internal Referral: the branch processing the sample ("Processing Branch"); `null` in the other menus. */
  processingBranch: string | null;
  /** In-House: the "RM Branch", i.e. the sample's origin branch. Referral menus: the sending branch ("Origin Branch"). */
  originBranch: string | null;
  outsourceCenter: string | null;
  /** External Referral: the partner lab's name (it has no branch). */
  externalPartner: string | null;
  sent: SearchDateTime;
  forwarded: SearchDateTime;
  outsourced: SearchDateTime;
}

/** A barcode that was found. */
export interface SampleSearchFound {
  found: true;
  menu: SearchMenu;
  barcode: string;
  order: {
    id: string;
    orderCode: string;
    externalOrderId: string | null;
    branchId: string | null;
    /** The order was registered at the caller's own branch: only then is billing shown. */
    billingVisible: boolean;
  };
  fields: SearchFields;
  sections: SearchSection[];
}

/** A barcode with nothing in this menu; `foundIn` names the other menus that do have it. */
export interface SampleSearchNotFound {
  found: false;
  menu: SearchMenu;
  barcode: string;
  foundIn: Array<SearchMenu | 'OUTSOURCE'>;
  /**
   * The code is a barcode a Repeat took off a sample that has a new barcode now: that new barcode. Only a message:
   * the old code never opens the new tube's sample. `null` otherwise.
   */
  replacedBy: string | null;
}

export type SampleSearchResult = SampleSearchFound | SampleSearchNotFound;
