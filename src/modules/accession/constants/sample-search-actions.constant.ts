import { SampleStatus, TransferStatus } from '@prisma/client';

/**
 * Sample Search popup: the buttons each status offers, exactly as the requirements document
 * (6 November 2026, "Search Sample - Actions by Current Status") lists them. The lookup then
 * narrows each list by what the backend would really allow (legal transition, order cancelled,
 * test removed, Store / Return gate, Discarded / Returned flags), so no button is offered that
 * the server would refuse for a known reason.
 */

/** The three order menus that carry the Search Sample button. */
export type SearchMenu = 'IN_HOUSE' | 'INTERNAL' | 'EXTERNAL';

/** In-House Orders: the actions per sample status. */
export const IN_HOUSE_SEARCH_ACTIONS: Readonly<
  Record<SampleStatus, readonly string[]>
> = {
  [SampleStatus.NEW]: ['Collect', 'Collect & Print', 'Hold', 'Cancel'],
  [SampleStatus.COLLECTED]: ['Accept', 'Acquire', 'Halt', 'Error', 'Retrieve'],
  [SampleStatus.ACCEPTED]: [
    'Store',
    'Repeat',
    'Return',
    'Send',
    'Forward',
    'Outsource',
    'Retrieve',
  ],
  [SampleStatus.ACQUIRED]: [
    'Accept',
    'Repeat',
    'Halt',
    'Error',
    'Store',
    'Retrieve',
  ],
  [SampleStatus.HALT]: [
    'Accept',
    'Repeat',
    'Return',
    'Store',
    'Error',
    'Retrieve',
  ],
  [SampleStatus.ERROR]: ['Repeat', 'Return', 'Retrieve'],
  [SampleStatus.HOLD]: ['Collect', 'Collect & Print', 'Cancel', 'Retrieve'],
  [SampleStatus.REPEAT]: [
    'Collect',
    'Collect & Print',
    'Hold',
    'Cancel',
    'Retrieve',
  ],
  [SampleStatus.SENT_INTERNAL]: ['Retrieve'],
  [SampleStatus.FORWARD_EXTERNAL]: ['Retrieve'],
  [SampleStatus.OUTSOURCED]: ['Retrieve'],
  [SampleStatus.STORED]: ['Retrieve'],
  // Retrieve out of Discarded / Returned also needs the recoverable / verified flag.
  [SampleStatus.DISCARDED]: ['Retrieve'],
  [SampleStatus.RETURNED]: ['Retrieve'],
  [SampleStatus.CANCELLED]: ['Retrieve'],
};

/** Internal and External Referral Orders: the actions per transfer status (same list for both). */
export const REFERRAL_SEARCH_ACTIONS: Readonly<
  Record<TransferStatus, readonly string[]>
> = {
  [TransferStatus.IN_TRANSIT]: ['Picked Up'],
  [TransferStatus.PICKED_UP]: ['Receive', 'Retrieve'],
  [TransferStatus.RECEIVED]: ['Accept', 'Reject', 'Retrieve'],
  [TransferStatus.ACCEPTED]: ['Repeat', 'Retrieve'],
  [TransferStatus.REPEAT]: ['Retrieve'],
  [TransferStatus.REJECTED]: ['Retrieve'],
};

/** Button label → the sample action it runs ('Collect & Print' runs Collect). */
export const IN_HOUSE_ACTION_KEY: Readonly<Record<string, string>> = {
  Collect: 'collect',
  'Collect & Print': 'collect',
  Accept: 'accept',
  Acquire: 'acquire',
  Halt: 'halt',
  Error: 'error',
  Hold: 'hold',
  Repeat: 'repeat',
  Store: 'store',
  Return: 'return',
  Cancel: 'cancel',
  Send: 'send',
  Forward: 'forward',
  Outsource: 'outsource',
  Retrieve: 'retrieve',
};

/** Button label → the transfer action it runs. */
export const REFERRAL_ACTION_KEY: Readonly<Record<string, string>> = {
  'Picked Up': 'pick-up',
  Receive: 'receive',
  Accept: 'accept',
  Repeat: 'repeat',
  Reject: 'reject',
  Retrieve: 'retrieve',
};

/** Extra buttons the popup adds for the two flags (not status changes). */
export const FLAG_ACTIONS = {
  MARK_RECOVERABLE: 'Mark Recoverable',
  MARK_NOT_RECOVERABLE: 'Mark Not Recoverable',
  MARK_RETURNED_VERIFIED: 'Mark Returned & Verified',
} as const;
