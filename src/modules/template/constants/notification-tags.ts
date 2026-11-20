/**
 * Global notification tag catalogue — every `{tag}` a messaging template
 * (Email / SMS / WhatsApp / in-app) may use, regardless of its `feature`.
 *
 * Tags are GLOBAL: the communication layer (`NotificationTagsService`) resolves
 * every key below for every send — automatic event notifications, "Share and
 * Inform", the appointment reminder and manual compose — so any tag works in
 * any template. A tag whose data the send has no source for (e.g. `{bill_id}`
 * on a business-suspended message) renders as an empty string, never as the
 * literal `{tag}` text.
 *
 * One tag per value: no aliases for retired ezHealthTrack spellings
 * (`{dn}`, `{order_id}`, `{firstname}`…) — templates use these canonical keys.
 * Served to the template editors by `GET /templates/tags` and
 * `GET /siteadmin/templates/tags`.
 */

/** One catalogue entry (key is written WITHOUT braces). */
export interface NotificationTagDef {
  key: string;
  label: string;
  description: string;
}

/** A labelled group of tags (for the grouped editor list). */
export interface NotificationTagGroup {
  label: string;
  tags: NotificationTagDef[];
}

/** The catalogue, grouped by domain. */
export const NOTIFICATION_TAGS_GROUPED: NotificationTagGroup[] = [
  {
    label: 'Recipient & Patient',
    tags: [
      {
        key: 'patient_name',
        label: 'Recipient name',
        description:
          "Name of the person the message is sent to (the patient's name on patient messages; the business or contact name otherwise).",
      },
      {
        key: 'pfn',
        label: 'Patient full name',
        description:
          "Full name of the order's patient (falls back to the recipient's name when there is no patient).",
      },
      {
        key: 'patient',
        label: 'Patient',
        description: 'Same value as {pfn}.',
      },
      {
        key: 'condition_name',
        label: 'You / family member',
        description:
          '"you" when the patient reads the message on their own phone; "your <relation> <first name>" (e.g. "your son Rahul") when the patient is a family member sharing the family head\'s mobile. Blank without a patient.',
      },
      {
        key: 'patient_unique_id',
        label: 'Patient unique ID',
        description: "The patient's UM ID.",
      },
      {
        key: 'email',
        label: 'Recipient email',
        description: "The recipient's email address on file.",
      },
    ],
  },
  {
    label: 'Business & Branch',
    tags: [
      {
        key: 'web_title',
        label: 'Business name',
        description: 'Name of the business (tenant).',
      },
      {
        key: 'business_short_name',
        label: 'Business short name',
        description:
          "The business's short name (falls back to the business name).",
      },
      {
        key: 'user_name',
        label: 'Branch name',
        description:
          'Name of the branch (falls back to the business name when there is no branch).',
      },
      {
        key: 'lab',
        label: 'Lab name',
        description: 'Same value as {user_name}.',
      },
      {
        key: 'branch_short_name',
        label: 'Branch short name',
        description:
          "The branch's short name (falls back to the business short name).",
      },
      {
        key: 'branch_phone_number',
        label: 'Branch phone',
        description: "The branch's phone number.",
      },
    ],
  },
  {
    label: 'Order & Payment',
    tags: [
      {
        key: 'order_number',
        label: 'Order number',
        description: 'The order ID (e.g. ORD-00012).',
      },
      {
        key: 'order_code',
        label: 'Order code',
        description: 'Same value as {order_number}.',
      },
      { key: 'bill_id', label: 'Bill ID', description: "The order's bill ID." },
      {
        key: 'test_list',
        label: 'Tests',
        description: 'Comma-separated tests / panels on the order.',
      },
      {
        key: 'currency',
        label: 'Currency',
        description: "The business's currency code (e.g. INR).",
      },
      {
        key: 'gross_amount',
        label: 'Gross amount',
        description: 'Order total before discount.',
      },
      {
        key: 'net_amount',
        label: 'Net amount',
        description: 'Order total after discount.',
      },
      {
        key: 'balance_amount',
        label: 'Balance amount',
        description: 'Amount still due on the order (net amount - paid).',
      },
      {
        key: 'amount',
        label: 'Transaction amount',
        description:
          'Amount of this payment (payment messages) or refund (refund / cancellation messages); blank on other messages.',
      },
    ],
  },
  {
    label: 'Appointment & Collection',
    tags: [
      {
        key: 'date',
        label: 'Date',
        description:
          'Date of the event, in the business date format — the appointment / sample-collection date on appointment messages.',
      },
      {
        key: 'time',
        label: 'Time',
        description:
          'Time of the event, in the business time format — the appointment / sample-collection time on appointment messages.',
      },
      {
        key: 'appointment_code',
        label: 'Appointment ID',
        description:
          "The order's appointment ID (e.g. APT-00045); blank when the order has no appointment.",
      },
      {
        key: 'location',
        label: 'Location',
        description:
          'Where the appointment takes place: the home-collection address for home visits, otherwise the branch name and address.',
      },
      {
        key: 'doctor_name',
        label: 'Doctor name',
        description:
          "The order's consulting (OPD) doctor, otherwise its referring doctor.",
      },
      {
        key: 'doctor_business_name',
        label: 'Doctor hospital / clinic',
        description: "The referring doctor's hospital or clinic name.",
      },
      {
        key: 'referring_panel_name',
        label: 'Referring panel',
        description:
          "Name of the order's referring (B2B) panel; blank for walk-in orders.",
      },
      {
        key: 'phlebotomist_name',
        label: 'Phlebotomist name',
        description: 'The phlebotomist assigned to the order.',
      },
      {
        key: 'phlebo_detail',
        label: 'Phlebotomist details',
        description: 'The assigned phlebotomist as "Name (phone)".',
      },
    ],
  },
  {
    label: 'Staff',
    tags: [
      {
        key: 'updated_by',
        label: 'Updated by',
        description: 'Name of the staff user who made the change.',
      },
    ],
  },
  {
    label: 'Links & Access',
    tags: [
      {
        key: 'weburl',
        label: 'Website URL',
        description: 'The patient portal / website URL.',
      },
      {
        key: 'short_link',
        label: 'Order link',
        description:
          "Link to the order's public patient-report page (the website URL when there is no order).",
      },
      {
        key: 'publish_report_url',
        label: 'Report link',
        description: 'Same value as {short_link}.',
      },
      {
        key: 'password',
        label: 'Report password',
        description:
          'Always blank — the public report page needs no password. Kept so older templates do not show a raw tag.',
      },
    ],
  },
];

/** Every catalogue key, in catalogue order. */
export const NOTIFICATION_TAG_KEYS: readonly string[] =
  NOTIFICATION_TAGS_GROUPED.flatMap((g) => g.tags.map((t) => t.key));

/** A `{ key: '' }` map over the whole catalogue (the "no data" baseline). */
export function emptyNotificationTagValues(): Record<string, string> {
  return Object.fromEntries(NOTIFICATION_TAG_KEYS.map((k) => [k, '']));
}
