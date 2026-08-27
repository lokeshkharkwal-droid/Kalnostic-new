import { ProfileKey } from './profile-registry.constant';
import { ROLE_MODULE_ACCESS } from './role-module-access.config';
import { moduleLabel } from './system-modules.constant';

/**
 * Module-grouped, fine-grained permission catalogue (source of truth).
 *
 * This is an **explicit** catalogue (not CRUD-generated): each permission is
 * hand-specified under a module → sub-section hierarchy per the product spec.
 * Only six modules are permission-bearing — `registration`, `accession`,
 * `lab_operations` (Laboratory), `business_admin`, `branch_admin`, `finance`;
 * every other system module carries no permissions.
 *
 * Permission keys are machine-generated as
 * `${moduleKey}:${sectionSlug}__${labelSlug}` so that labels which repeat across
 * sub-sections (e.g. "Update appointment date and time", "Pick up the sample")
 * stay globally unique.
 *
 * NOTE: this defines the catalogue only. Wiring each key to actual behaviour
 * (route guards / feature gating) is intentionally NOT done here.
 */
export interface ModulePermissionEntry {
  moduleKey: string;
  /** Sub-section slug within the module (stable id). */
  section: string;
  /** Human-readable sub-section heading. */
  sectionLabel: string;
  permissionKey: string;
  label: string;
}

/** A sub-section of a module: a heading + its ordered permission labels. */
interface SectionSpec {
  label: string;
  permissions: string[];
}

/** slugify: lower-case, non-alphanumeric runs → single underscore, trimmed. */
function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** The six standard incident-management permissions, reused across modules. */
const INCIDENT: string[] = [
  'Create incident report',
  'Update incident report',
  'Reassign to other user',
  'Delete incident report',
  'Update the status',
  'Close the incident',
];

/** The eight referral-order sample actions, reused across referral sub-sections. */
const REFERRAL_ORDER: string[] = [
  'Pick up the sample',
  'Receive the sample',
  'Accept the sample',
  'Reject the sample',
  'Repeat the sample',
  'Update sample notes',
  'Assign the barcode',
  'Allow multiple action',
];

/**
 * The explicit permission catalogue: module key → ordered sub-sections → ordered
 * permission labels. This is the single source of truth the modal renders from.
 */
const PERMISSION_SPEC: Record<string, SectionSpec[]> = {
  registration: [
    {
      label: 'Create Order / Patient Details',
      permissions: [
        'Allow create order',
        'View create order',
        'Create patient',
        'Update patient details',
        'View past order',
        'Convert past orders',
        'Update patient category',
        'Update privilege card',
      ],
    },
    {
      label: 'Order Details',
      permissions: [
        'Update order ID',
        'Update order date & time',
        'Update order type',
        'Update billing type',
        'Update order notes',
        'Allow zero bill order',
      ],
    },
    {
      label: 'Diagnostic Details',
      permissions: [
        'Update sample source',
        'Update sample collection charges',
        'Update visit charges',
        'Add short phlebotomist name',
        'Update phlebotomist name',
        'Update collection date and time',
      ],
    },
    {
      label: 'OPD Details',
      permissions: [
        'Add short consultant',
        'Update consultant',
        'Update consultation type',
        'Update visit type',
        'Update appointment date and time',
      ],
    },
    {
      label: 'Radiology Details',
      permissions: [
        'Add short radiologist',
        'Update radiologist',
        'Add short radiology technician',
        'Update radiology technician',
        'Update appointment date & time',
      ],
    },
    {
      label: 'Payment Details',
      permissions: [
        'Allowable order discount (percentage)',
        'Deduct from wallet',
        'Clear previous dues',
        'Deduct from loyalty points',
        'Allow TDS deduction',
        'Update TDS deduction',
        'Update paid amount',
        'Update payment mode',
        'Update payment notes',
        'Update refund amount',
        'Update cancelled amount',
        'Update cancellation charges',
      ],
    },
    {
      label: 'Billings',
      permissions: [
        'Cancellation of order with refund',
        'Cancellation of order without refund',
        'Settle payment of other users',
      ],
    },
    {
      label: 'Quotations',
      permissions: [
        'Create quotation',
        'Update quotation',
        'Recreate quotation',
        'Convert quotation',
      ],
    },
    {
      label: 'Appointments',
      permissions: [
        'Create appointment',
        'Edit the appointment',
        'Update appointment',
        'Confirm the appointment',
        'Checked in the appointment',
        'Cancel the appointment with refund',
        'Cancel the appointment without refund',
        'View doctors list',
        'View doctors schedule',
        'Add doctor configuration',
        'Update doctor configuration',
        'View phlebotomists list',
        'View phlebotomists schedule',
        'Add phlebotomist configuration',
        'Update phlebotomist configuration',
      ],
    },
    {
      label: 'Order Console',
      permissions: ['View only', 'Update in the order console'],
    },
    {
      label: 'Reports',
      permissions: ['View reports of users', 'View reports of all users'],
    },
    {
      label: 'Registration Settings',
      permissions: [
        'View registration settings',
        'Update registration settings',
      ],
    },
    { label: 'Incident Reports', permissions: INCIDENT },
  ],

  accession: [
    {
      label: 'In-House Order',
      permissions: [
        'Collect the sample',
        'Accept the sample',
        'Acquired the sample',
        'Error the sample',
        'Hold the sample',
        'Halt the sample',
        'Send the sample',
        'Assign internal referral center',
        'Update internal referral center',
        'Forward the sample',
        'Assign external referral center',
        'Update the external referral center',
        'Outsource the sample',
        'Assign outsource center',
        'Update outsource center',
        'Discard the sample',
        'Store sample',
        'Return the sample',
        'Cancel the sample',
        'Assign barcode',
        'Retrieve the action',
        'Update the sample notes',
        'Allow multiple action',
      ],
    },
    { label: 'Internal Referral Order', permissions: REFERRAL_ORDER },
    { label: 'External Referral Order', permissions: REFERRAL_ORDER },
    { label: 'Outsource Orders', permissions: REFERRAL_ORDER },
    {
      label: 'Order Console',
      permissions: ['View only', 'Update in the order console'],
    },
    {
      label: 'Reports',
      permissions: ['View reports of users', 'View reports of all users'],
    },
    {
      label: 'Accession Settings',
      permissions: ['View accession settings', 'Update accession settings'],
    },
    { label: 'Incident Reports', permissions: INCIDENT },
  ],

  lab_operations: [
    {
      label: 'Reporting',
      permissions: [
        'Access to pending',
        'Access to partial pending',
        'Access to saved',
        'Access to validation pending',
        'Access to result done',
        'Access to approved',
        'Access to published',
        'Edit report',
        'Mark as error reported',
        'Access to error reported',
        'Mark as result rejected',
        'Access to result rejected',
        'Mark as lock test',
        'Mark as delta check',
        'Access to delta check list',
        'Update delta check tests',
        'Mark as critical alert',
        'Access to critical alerts list',
        'Update critical alert test',
        'Mark as out of reference range',
        'Access to out of reference range',
        'Update out of reference range test',
        'Mark as re-run test',
        'Access to re-run test list',
        'Update re-run test',
        'Mark as multistep process',
        'Mark as scheduled test',
        'Access to scheduled test list',
        'Update scheduled test',
        'View inventory',
        'Update inventory',
        'View trend report',
        'Upload images',
        'Update images',
        'Upload file',
        'Update file',
        'Upload document',
        'Update document',
        'Access to enter result',
        'Do bulk action',
        'Update technician notes',
      ],
    },
    {
      label: 'Order Console',
      permissions: [
        'View only',
        'Update in the order console',
        'Upload documents',
        'Update documents',
      ],
    },
    { label: 'Reports', permissions: ['View reports'] },
    {
      label: 'Laboratory Settings',
      permissions: ['View laboratory settings', 'Update laboratory settings'],
    },
    { label: 'Incident Reports', permissions: INCIDENT },
  ],

  business_admin: [
    {
      label: 'Master Data',
      permissions: [
        'Add test',
        'Update test',
        'Delete test',
        'Disable test',
        'Duplicate test',
        'Allow multiple edit',
        'Update customized view of tests',
        'Allow export tests',
        'Allow import tests',
        'Add lab panel',
        'Update lab panel',
        'Edit the panel',
        'Duplicate the panel',
        'Delete the panel',
      ],
    },
    {
      label: 'Lab Test List',
      permissions: [
        'View lab test list of assigned branch only',
        'View lab test list of all branches',
      ],
    },
    {
      label: 'Lab Panel List',
      permissions: [
        'View lab panel list of assigned branch only',
        'View lab panel list of all branches',
      ],
    },
    { label: 'Outsource Centers', permissions: ['View outsource center list'] },
    {
      label: 'Reporting Doctors',
      permissions: [
        'View reporting doctors list',
        'View consultant doctors list',
      ],
    },
    {
      label: 'Referrals',
      permissions: [
        'View referral doctors list',
        'View referral panel list',
        'View external referral user list',
        'View internal referral users list',
      ],
    },
    {
      label: 'Document Management',
      permissions: ['Add document', 'Update document', 'Delete document'],
    },
    {
      label: 'Center and Operations',
      permissions: [
        'Add new branch',
        'Update branch',
        'Delete branch',
        'View schedule of branches',
        'Link branch',
        'Edit link',
        'Delete link',
        'View audit',
        'View subscription plan',
        'Add new subscription feature',
        'Inactivate subscription feature',
      ],
    },
    {
      label: 'User Management',
      permissions: [
        'Add user',
        'View only users list',
        'Update users',
        'View only user permissions',
        'Update the user permissions',
      ],
    },
    { label: 'Incident Management', permissions: INCIDENT },
    {
      label: 'Lab Test Settings',
      permissions: [
        'Add image settings',
        'Edit image settings',
        'Delete image settings',
        'Add icon settings',
        'Edit icon settings',
        'Delete icon settings',
        'Add pdf settings',
        'Edit pdf settings',
        'Delete pdf settings',
        'Add group layout',
        'Edit group layout',
        'Delete group layout',
      ],
    },
    {
      label: 'Templates',
      permissions: [
        'Add SMS template',
        'Edit SMS template',
        'Delete SMS template',
        'Add email template',
        'Edit email template',
        'Delete email template',
        'Add whatsapp template',
        'Edit whatsapp template',
        'Delete whatsapp template',
        'Add consent form',
        'Edit consent form',
        'Delete consent form',
        'Add report template',
        'Edit report template',
        'Delete report template',
      ],
    },
    {
      label: 'Referral Panel Settings',
      permissions: ['View referral panel settings'],
    },
    { label: 'Machines', permissions: ['View machines'] },
  ],

  branch_admin: [
    {
      label: 'Master Data',
      permissions: ['Import master lab tests', 'Import master lab panels'],
    },
    {
      label: 'Lab Test List',
      permissions: [
        'Add lab test list',
        'Bulk edit test list',
        'Delete test list',
        'Clone list',
        'Rename list',
        'Import master data into test list',
      ],
    },
    {
      label: 'Lab Panel List',
      permissions: [
        'Add lab panel list',
        'Bulk edit panel list',
        'Delete panel list',
        'Clone list',
        'Rename list',
        'Import master data into panel list',
      ],
    },
    {
      label: 'Outsource Centers',
      permissions: [
        'Add outsource center',
        'Update outsource center',
        'Delete outsource center',
      ],
    },
    {
      label: 'Reporting Doctors',
      permissions: [
        'Add reporting doctor',
        'Update reporting doctor',
        'Delete reporting doctor',
      ],
    },
    {
      label: 'Consultant Doctors',
      permissions: [
        'Add consultant doctor',
        'Update consultant doctor',
        'Delete consultant doctor',
      ],
    },
    {
      label: 'Referrals',
      permissions: [
        'Add referral panel',
        'Update referral panel',
        'Delete referral panel',
        'Add referral doctor',
        'Update referral doctor',
        'Delete referral doctor',
        'Add external referral user',
        'Update external referral user',
        'Delete external referral user',
        'Add internal referral user',
        'Update internal referral user',
        'Delete internal referral user',
      ],
    },
    {
      label: 'Document Management',
      permissions: ['Add document', 'Update document', 'Delete document'],
    },
    {
      label: 'Center and Operations',
      permissions: [
        'View schedule of branch',
        'View audit',
        'View subscription plan',
      ],
    },
    {
      label: 'User Management',
      permissions: [
        'View only users list for assigned branch',
        'Update users for assigned branch',
        'View only user permissions for assigned branch',
        'Update the user permissions for assigned branch',
      ],
    },
    { label: 'Incident Management', permissions: INCIDENT },
    {
      label: 'Referral Panel Settings',
      permissions: [
        'Create cash referral panel settings',
        'Edit cash referral panel settings',
        'Delete cash referral panel settings',
        'Create credit referral panel settings',
        'Edit credit referral panel settings',
        'Delete credit referral panel settings',
        'Create prepaid referral panel settings',
        'Edit prepaid referral panel settings',
        'Delete prepaid referral panel settings',
      ],
    },
    {
      label: 'Machines',
      permissions: ['Add machine', 'Edit machine', 'Delete machine'],
    },
  ],

  finance: [
    {
      label: 'Financial Reports',
      permissions: [
        'View billing reports',
        'View collection reports',
        'View outstanding reports',
        'View refund reports',
        'View cancel reports',
      ],
    },
    {
      label: 'Invoice',
      permissions: [
        'List view only',
        'Create invoice',
        'Cancel invoice',
        'Receive invoice payment',
      ],
    },
    {
      label: 'Settlements',
      permissions: [
        'List view only',
        'Create settlement',
        'Cancel settlement',
        'Approve settlement amount',
        'Settle amount',
      ],
    },
    {
      label: 'Payments',
      permissions: [
        'List view only',
        'Edit invoice payment',
        'Edit direct order payment',
        'Cancel invoice payment',
        'Cancel direct order payment',
      ],
    },
    {
      label: 'Wallet',
      permissions: ['Wallet list view only', 'Add wallet', 'Adjust wallet'],
    },
    {
      label: 'Privilege Card',
      permissions: ['Privilege cards list view only', 'Add privilege cards'],
    },
    { label: 'Loyalty Points', permissions: ['Loyalty points list view only'] },
    {
      label: 'Financial Settings',
      permissions: [
        'View only wallet settings',
        'Update wallet settings',
        'View only privilege card settings',
        'Update privilege card settings',
        'View only loyalty point settings',
        'Update loyalty point settings',
        'View only invoice settings',
        'Update invoice settings',
        'View only TDS settings',
        'Update TDS settings',
        'View only settlement settings',
        'Update settlement settings',
      ],
    },
    { label: 'Incident Management', permissions: INCIDENT },
  ],

  // Operational modules with built FE pages but no fine-grained permissions yet.
  // A single "view" permission each makes them permission-bearing so the FE
  // reveals the tab/route (module visibility requires `moduleAllowed`); the pages
  // themselves are otherwise ungated. Expand these sections when real per-action
  // control is needed.
  inventory: [{ label: 'Inventory', permissions: ['View inventory'] }],
  sales: [{ label: 'Sales', permissions: ['View sales'] }],
  phlebotomist: [
    { label: 'Phlebotomist', permissions: ['View phlebotomist'] },
  ],
};

/** The permission-bearing module keys, in catalogue order. */
export const PERMISSION_BEARING_MODULE_KEYS: string[] =
  Object.keys(PERMISSION_SPEC);

/**
 * The flat, module-grouped permission catalogue. Generated from
 * {@link PERMISSION_SPEC}; each entry carries its module + sub-section + a
 * globally-unique `permissionKey`.
 */
export const MODULE_PERMISSION_CATALOG: ModulePermissionEntry[] =
  Object.entries(PERMISSION_SPEC).flatMap(([moduleKey, sections]) =>
    sections.flatMap((sec) => {
      const sectionSlug = slug(sec.label);
      return sec.permissions.map((label) => ({
        moduleKey,
        section: sectionSlug,
        sectionLabel: sec.label,
        permissionKey: `${moduleKey}:${sectionSlug}__${slug(label)}`,
        label,
      }));
    }),
  );

/**
 * Stable, code-referenced permission keys (for guards/wiring that name a
 * specific permission). Values MUST match the generated keys in
 * {@link MODULE_PERMISSION_CATALOG}.
 */
export const PERMISSION_KEYS = {
  REGISTRATION_SETTINGS_VIEW:
    'registration:registration_settings__view_registration_settings',
  REGISTRATION_SETTINGS_UPDATE:
    'registration:registration_settings__update_registration_settings',

  // ── Registration — action keys enforced server-side (see order/appointment
  //    controllers). Distinct from field-level keys, which are FE-gated. ──
  REG_ALLOW_CREATE_ORDER:
    'registration:create_order_patient_details__allow_create_order',
  REG_CREATE_PATIENT:
    'registration:create_order_patient_details__create_patient',
  REG_UPDATE_PATIENT_DETAILS:
    'registration:create_order_patient_details__update_patient_details',
  REG_VIEW_PAST_ORDER:
    'registration:create_order_patient_details__view_past_order',
  REG_CONVERT_PAST_ORDERS:
    'registration:create_order_patient_details__convert_past_orders',
  REG_UPDATE_PATIENT_CATEGORY:
    'registration:create_order_patient_details__update_patient_category',
  REG_UPDATE_PRIVILEGE_CARD:
    'registration:create_order_patient_details__update_privilege_card',
  REG_UPDATE_ORDER_ID: 'registration:order_details__update_order_id',
  REG_CREATE_QUOTATION: 'registration:quotations__create_quotation',
  REG_CONVERT_QUOTATION: 'registration:quotations__convert_quotation',
  REG_RECREATE_QUOTATION: 'registration:quotations__recreate_quotation',
  REG_CREATE_APPOINTMENT: 'registration:appointments__create_appointment',
  REG_CONFIRM_APPOINTMENT: 'registration:appointments__confirm_the_appointment',
  REG_CHECKIN_APPOINTMENT:
    'registration:appointments__checked_in_the_appointment',
  REG_UPDATE_APPOINTMENT: 'registration:appointments__update_appointment',
  REG_CANCEL_APPOINTMENT_WITH_REFUND:
    'registration:appointments__cancel_the_appointment_with_refund',
  REG_CANCEL_APPOINTMENT_WITHOUT_REFUND:
    'registration:appointments__cancel_the_appointment_without_refund',
  REG_CANCEL_ORDER_WITH_REFUND:
    'registration:billings__cancellation_of_order_with_refund',
  REG_CANCEL_ORDER_WITHOUT_REFUND:
    'registration:billings__cancellation_of_order_without_refund',
  REG_UPDATE_REFUND_AMOUNT:
    'registration:payment_details__update_refund_amount',

  // Money (field-level) keys enforced server-side in OrderService money checks.
  REG_ORDER_DISCOUNT:
    'registration:payment_details__allowable_order_discount_percentage',
  REG_ALLOW_TDS: 'registration:payment_details__allow_tds_deduction',
  REG_UPDATE_PAID_AMOUNT: 'registration:payment_details__update_paid_amount',

  // ── Registration — other server-enforced actions ──
  //    Zero-bill: creating a real ORDER with "Generate Bill = No"
  //    (isBillGenerated === false) requires this permission.
  REG_ALLOW_ZERO_BILL_ORDER:
    'registration:order_details__allow_zero_bill_order',
  //    Settle payment on an order created by ANOTHER user (layered on top of the
  //    branch's AllowCollectionOfAmountByOtherUser setting) — POST /payments.
  REG_SETTLE_PAYMENT_OTHERS:
    'registration:billings__settle_payment_of_other_users',
  //    Doctor / phlebotomist schedule CONFIG writes (Appointments feature). The
  //    view/list/calendar reads stay FE-gated so the create-order appointment
  //    flow is never broken.
  REG_ADD_DOCTOR_CONFIG: 'registration:appointments__add_doctor_configuration',
  REG_UPDATE_DOCTOR_CONFIG:
    'registration:appointments__update_doctor_configuration',
  REG_ADD_PHLEBOTOMIST_CONFIG:
    'registration:appointments__add_phlebotomist_configuration',
  REG_UPDATE_PHLEBOTOMIST_CONFIG:
    'registration:appointments__update_phlebotomist_configuration',

  // ── Accession — In-House sample lifecycle (route-guarded 1:1) ──
  ACC_IH_COLLECT: 'accession:in_house_order__collect_the_sample',
  ACC_IH_ACCEPT: 'accession:in_house_order__accept_the_sample',
  ACC_IH_ACQUIRE: 'accession:in_house_order__acquired_the_sample',
  ACC_IH_HALT: 'accession:in_house_order__halt_the_sample',
  ACC_IH_ERROR: 'accession:in_house_order__error_the_sample',
  ACC_IH_HOLD: 'accession:in_house_order__hold_the_sample',
  ACC_IH_STORE: 'accession:in_house_order__store_sample',
  ACC_IH_DISCARD: 'accession:in_house_order__discard_the_sample',
  ACC_IH_RETURN: 'accession:in_house_order__return_the_sample',
  ACC_IH_CANCEL: 'accession:in_house_order__cancel_the_sample',
  ACC_IH_RETRIEVE: 'accession:in_house_order__retrieve_the_action',
  ACC_IH_ASSIGN_BARCODE: 'accession:in_house_order__assign_barcode',
  ACC_IH_UPDATE_NOTES: 'accession:in_house_order__update_the_sample_notes',
  ACC_IH_SEND: 'accession:in_house_order__send_the_sample',
  ACC_IH_FORWARD: 'accession:in_house_order__forward_the_sample',
  ACC_IH_OUTSOURCE: 'accession:in_house_order__outsource_the_sample',
  ACC_IH_ASSIGN_INTERNAL_CENTER:
    'accession:in_house_order__assign_internal_referral_center',
  ACC_IH_ASSIGN_EXTERNAL_CENTER:
    'accession:in_house_order__assign_external_referral_center',
  ACC_IH_ASSIGN_OUTSOURCE_CENTER:
    'accession:in_house_order__assign_outsource_center',
  // Update (re-assign) an already-set transfer center — enforced on
  // `assign-center` when the transfer already has a destination.
  ACC_IH_UPDATE_INTERNAL_CENTER:
    'accession:in_house_order__update_internal_referral_center',
  ACC_IH_UPDATE_EXTERNAL_CENTER:
    'accession:in_house_order__update_the_external_referral_center',
  ACC_IH_UPDATE_OUTSOURCE_CENTER:
    'accession:in_house_order__update_outsource_center',

  // ── Accession — Settings + Reports (route-guarded) ──
  ACC_SETTINGS_VIEW: 'accession:accession_settings__view_accession_settings',
  ACC_SETTINGS_UPDATE:
    'accession:accession_settings__update_accession_settings',
  ACC_REPORTS_VIEW_USERS: 'accession:reports__view_reports_of_users',
  ACC_REPORTS_VIEW_ALL: 'accession:reports__view_reports_of_all_users',

  // ── Accession — Referral/Outsource receiving actions. The transfer endpoints
  //    are shared across kinds, so the controller asserts the caller holds the
  //    action for AT LEAST ONE referral type (assertAny of these). ──
  ACC_INT_PICKUP: 'accession:internal_referral_order__pick_up_the_sample',
  ACC_EXT_PICKUP: 'accession:external_referral_order__pick_up_the_sample',
  ACC_OUT_PICKUP: 'accession:outsource_orders__pick_up_the_sample',
  ACC_INT_RECEIVE: 'accession:internal_referral_order__receive_the_sample',
  ACC_EXT_RECEIVE: 'accession:external_referral_order__receive_the_sample',
  ACC_OUT_RECEIVE: 'accession:outsource_orders__receive_the_sample',
  ACC_INT_ACCEPT: 'accession:internal_referral_order__accept_the_sample',
  ACC_EXT_ACCEPT: 'accession:external_referral_order__accept_the_sample',
  ACC_OUT_ACCEPT: 'accession:outsource_orders__accept_the_sample',
  ACC_INT_REJECT: 'accession:internal_referral_order__reject_the_sample',
  ACC_EXT_REJECT: 'accession:external_referral_order__reject_the_sample',
  ACC_OUT_REJECT: 'accession:outsource_orders__reject_the_sample',
  ACC_INT_REPEAT: 'accession:internal_referral_order__repeat_the_sample',
  ACC_EXT_REPEAT: 'accession:external_referral_order__repeat_the_sample',
  ACC_OUT_REPEAT: 'accession:outsource_orders__repeat_the_sample',

  // ── Laboratory (lab_operations) — Reporting worklist access + actions.
  //    The spec has no explicit validate/approve/publish keys: working a queue
  //    is gated by "access to <that status>". ──
  LAB_ACCESS_PENDING: 'lab_operations:reporting__access_to_pending',
  LAB_ACCESS_PARTIAL_PENDING:
    'lab_operations:reporting__access_to_partial_pending',
  LAB_ACCESS_SAVED: 'lab_operations:reporting__access_to_saved',
  LAB_ACCESS_VALIDATION_PENDING:
    'lab_operations:reporting__access_to_validation_pending',
  LAB_ACCESS_RESULT_DONE: 'lab_operations:reporting__access_to_result_done',
  LAB_ACCESS_APPROVED: 'lab_operations:reporting__access_to_approved',
  LAB_ACCESS_PUBLISHED: 'lab_operations:reporting__access_to_published',
  LAB_EDIT_REPORT: 'lab_operations:reporting__edit_report',
  LAB_MARK_ERROR_REPORTED: 'lab_operations:reporting__mark_as_error_reported',
  LAB_ACCESS_ERROR_REPORTED:
    'lab_operations:reporting__access_to_error_reported',
  LAB_MARK_RESULT_REJECTED: 'lab_operations:reporting__mark_as_result_rejected',
  LAB_ACCESS_RESULT_REJECTED:
    'lab_operations:reporting__access_to_result_rejected',
  LAB_MARK_LOCK_TEST: 'lab_operations:reporting__mark_as_lock_test',
  LAB_MARK_DELTA_CHECK: 'lab_operations:reporting__mark_as_delta_check',
  LAB_ACCESS_DELTA_LIST: 'lab_operations:reporting__access_to_delta_check_list',
  LAB_UPDATE_DELTA: 'lab_operations:reporting__update_delta_check_tests',
  LAB_MARK_CRITICAL_ALERT: 'lab_operations:reporting__mark_as_critical_alert',
  LAB_ACCESS_CRITICAL_LIST:
    'lab_operations:reporting__access_to_critical_alerts_list',
  LAB_UPDATE_CRITICAL: 'lab_operations:reporting__update_critical_alert_test',
  LAB_MARK_OOR: 'lab_operations:reporting__mark_as_out_of_reference_range',
  LAB_ACCESS_OOR: 'lab_operations:reporting__access_to_out_of_reference_range',
  LAB_UPDATE_OOR:
    'lab_operations:reporting__update_out_of_reference_range_test',
  LAB_MARK_RE_RUN: 'lab_operations:reporting__mark_as_re_run_test',
  LAB_ACCESS_RE_RUN_LIST:
    'lab_operations:reporting__access_to_re_run_test_list',
  LAB_UPDATE_RE_RUN: 'lab_operations:reporting__update_re_run_test',
  LAB_MARK_MULTISTEP: 'lab_operations:reporting__mark_as_multistep_process',
  LAB_MARK_SCHEDULED: 'lab_operations:reporting__mark_as_scheduled_test',
  LAB_ACCESS_SCHEDULED_LIST:
    'lab_operations:reporting__access_to_scheduled_test_list',
  LAB_UPDATE_SCHEDULED: 'lab_operations:reporting__update_scheduled_test',
  LAB_VIEW_INVENTORY: 'lab_operations:reporting__view_inventory',
  LAB_UPDATE_INVENTORY: 'lab_operations:reporting__update_inventory',
  LAB_VIEW_TREND: 'lab_operations:reporting__view_trend_report',
  LAB_ENTER_RESULT: 'lab_operations:reporting__access_to_enter_result',
  LAB_BULK_ACTION: 'lab_operations:reporting__do_bulk_action',
  LAB_UPDATE_TECH_NOTES: 'lab_operations:reporting__update_technician_notes',
  LAB_SETTINGS_VIEW:
    'lab_operations:laboratory_settings__view_laboratory_settings',
  LAB_SETTINGS_UPDATE:
    'lab_operations:laboratory_settings__update_laboratory_settings',

  // ── Finance — implemented sub-sections (wallet/privilege/loyalty/incident
  //    are not built, so no keys are referenced for them). ──
  FIN_REPORT_BILLING: 'finance:financial_reports__view_billing_reports',
  FIN_REPORT_COLLECTION: 'finance:financial_reports__view_collection_reports',
  FIN_REPORT_OUTSTANDING: 'finance:financial_reports__view_outstanding_reports',
  FIN_REPORT_REFUND: 'finance:financial_reports__view_refund_reports',
  FIN_REPORT_CANCEL: 'finance:financial_reports__view_cancel_reports',

  FIN_INVOICE_LIST: 'finance:invoice__list_view_only',
  FIN_INVOICE_CREATE: 'finance:invoice__create_invoice',
  FIN_INVOICE_CANCEL: 'finance:invoice__cancel_invoice',
  FIN_INVOICE_RECEIVE_PAYMENT: 'finance:invoice__receive_invoice_payment',

  FIN_SETTLE_LIST: 'finance:settlements__list_view_only',
  FIN_SETTLE_CREATE: 'finance:settlements__create_settlement',
  FIN_SETTLE_CANCEL: 'finance:settlements__cancel_settlement',
  FIN_SETTLE_APPROVE: 'finance:settlements__approve_settlement_amount',
  FIN_SETTLE_SETTLE: 'finance:settlements__settle_amount',

  FIN_PAYMENTS_LIST: 'finance:payments__list_view_only',
  FIN_PAYMENTS_EDIT_INVOICE: 'finance:payments__edit_invoice_payment',
  FIN_PAYMENTS_EDIT_DIRECT: 'finance:payments__edit_direct_order_payment',
  FIN_PAYMENTS_CANCEL_INVOICE: 'finance:payments__cancel_invoice_payment',
  FIN_PAYMENTS_CANCEL_DIRECT: 'finance:payments__cancel_direct_order_payment',

  FIN_SETTINGS_INVOICE_VIEW:
    'finance:financial_settings__view_only_invoice_settings',
  FIN_SETTINGS_INVOICE_UPDATE:
    'finance:financial_settings__update_invoice_settings',
  FIN_SETTINGS_TDS_VIEW: 'finance:financial_settings__view_only_tds_settings',
  FIN_SETTINGS_TDS_UPDATE: 'finance:financial_settings__update_tds_settings',
  FIN_SETTINGS_SETTLEMENT_VIEW:
    'finance:financial_settings__view_only_settlement_settings',
  FIN_SETTINGS_SETTLEMENT_UPDATE:
    'finance:financial_settings__update_settlement_settings',

  // ── Business Admin — write actions (route-guarded). Views are left open
  //    because the same resource controllers serve both admin consoles; the
  //    `business_admin` role bypasses all checks (ADMIN_BYPASS_ROLES). ──
  BA_MD_ADD_TEST: 'business_admin:master_data__add_test',
  BA_MD_UPDATE_TEST: 'business_admin:master_data__update_test',
  BA_MD_DELETE_TEST: 'business_admin:master_data__delete_test',
  BA_MD_DUPLICATE_TEST: 'business_admin:master_data__duplicate_test',
  BA_MD_ALLOW_MULTIPLE_EDIT: 'business_admin:master_data__allow_multiple_edit',
  BA_MD_ALLOW_IMPORT_TESTS: 'business_admin:master_data__allow_import_tests',
  BA_MD_ADD_LAB_PANEL: 'business_admin:master_data__add_lab_panel',
  BA_MD_UPDATE_LAB_PANEL: 'business_admin:master_data__update_lab_panel',
  BA_MD_EDIT_THE_PANEL: 'business_admin:master_data__edit_the_panel',
  BA_MD_DUPLICATE_THE_PANEL: 'business_admin:master_data__duplicate_the_panel',
  BA_MD_DELETE_THE_PANEL: 'business_admin:master_data__delete_the_panel',

  BA_DOC_ADD: 'business_admin:document_management__add_document',
  BA_DOC_UPDATE: 'business_admin:document_management__update_document',
  BA_DOC_DELETE: 'business_admin:document_management__delete_document',

  BA_BRANCH_ADD: 'business_admin:center_and_operations__add_new_branch',
  BA_BRANCH_UPDATE: 'business_admin:center_and_operations__update_branch',
  BA_BRANCH_DELETE: 'business_admin:center_and_operations__delete_branch',
  BA_BRANCH_LINK: 'business_admin:center_and_operations__link_branch',
  BA_BRANCH_EDIT_LINK: 'business_admin:center_and_operations__edit_link',
  BA_BRANCH_DELETE_LINK: 'business_admin:center_and_operations__delete_link',

  BA_UM_ADD_USER: 'business_admin:user_management__add_user',
  BA_UM_UPDATE_USERS: 'business_admin:user_management__update_users',
  BA_UM_UPDATE_PERMISSIONS:
    'business_admin:user_management__update_the_user_permissions',

  BA_LTS_ADD_IMAGE: 'business_admin:lab_test_settings__add_image_settings',
  BA_LTS_EDIT_IMAGE: 'business_admin:lab_test_settings__edit_image_settings',
  BA_LTS_DELETE_IMAGE:
    'business_admin:lab_test_settings__delete_image_settings',
  BA_LTS_ADD_ICON: 'business_admin:lab_test_settings__add_icon_settings',
  BA_LTS_EDIT_ICON: 'business_admin:lab_test_settings__edit_icon_settings',
  BA_LTS_DELETE_ICON: 'business_admin:lab_test_settings__delete_icon_settings',
  BA_LTS_ADD_PDF: 'business_admin:lab_test_settings__add_pdf_settings',
  BA_LTS_EDIT_PDF: 'business_admin:lab_test_settings__edit_pdf_settings',
  BA_LTS_DELETE_PDF: 'business_admin:lab_test_settings__delete_pdf_settings',
  BA_LTS_ADD_GROUP: 'business_admin:lab_test_settings__add_group_layout',
  BA_LTS_EDIT_GROUP: 'business_admin:lab_test_settings__edit_group_layout',
  BA_LTS_DELETE_GROUP: 'business_admin:lab_test_settings__delete_group_layout',

  BA_TPL_ADD_SMS: 'business_admin:templates__add_sms_template',
  BA_TPL_EDIT_SMS: 'business_admin:templates__edit_sms_template',
  BA_TPL_DELETE_SMS: 'business_admin:templates__delete_sms_template',
  BA_TPL_ADD_EMAIL: 'business_admin:templates__add_email_template',
  BA_TPL_EDIT_EMAIL: 'business_admin:templates__edit_email_template',
  BA_TPL_DELETE_EMAIL: 'business_admin:templates__delete_email_template',
  BA_TPL_ADD_WHATSAPP: 'business_admin:templates__add_whatsapp_template',
  BA_TPL_EDIT_WHATSAPP: 'business_admin:templates__edit_whatsapp_template',
  BA_TPL_DELETE_WHATSAPP: 'business_admin:templates__delete_whatsapp_template',
  BA_TPL_ADD_CONSENT: 'business_admin:templates__add_consent_form',
  BA_TPL_EDIT_CONSENT: 'business_admin:templates__edit_consent_form',
  BA_TPL_DELETE_CONSENT: 'business_admin:templates__delete_consent_form',
  BA_TPL_ADD_REPORT: 'business_admin:templates__add_report_template',
  BA_TPL_EDIT_REPORT: 'business_admin:templates__edit_report_template',
  BA_TPL_DELETE_REPORT: 'business_admin:templates__delete_report_template',

  // ── Branch Admin — write actions (route-guarded). The `branch_admin` role's
  //    baseline includes these, so it is not bypassed but is granted by default;
  //    delegated roles need the explicit grant. ──
  BR_LTL_ADD: 'branch_admin:lab_test_list__add_lab_test_list',
  BR_LTL_BULK_EDIT: 'branch_admin:lab_test_list__bulk_edit_test_list',
  BR_LTL_DELETE: 'branch_admin:lab_test_list__delete_test_list',
  BR_LTL_CLONE: 'branch_admin:lab_test_list__clone_list',
  BR_LTL_RENAME: 'branch_admin:lab_test_list__rename_list',
  BR_LPL_ADD: 'branch_admin:lab_panel_list__add_lab_panel_list',
  BR_LPL_BULK_EDIT: 'branch_admin:lab_panel_list__bulk_edit_panel_list',
  BR_LPL_DELETE: 'branch_admin:lab_panel_list__delete_panel_list',
  BR_LPL_CLONE: 'branch_admin:lab_panel_list__clone_list',
  BR_LPL_RENAME: 'branch_admin:lab_panel_list__rename_list',

  // Branch Master Data — Tenant→Branch import (the "Import Master Data" sync
  // touches both tests + panels atomically; the route is guarded with assertAny
  // of the two so granting either permits the combined import).
  BR_MD_IMPORT_TESTS: 'branch_admin:master_data__import_master_lab_tests',
  BR_MD_IMPORT_PANELS: 'branch_admin:master_data__import_master_lab_panels',

  BR_OUT_ADD: 'branch_admin:outsource_centers__add_outsource_center',
  BR_OUT_UPDATE: 'branch_admin:outsource_centers__update_outsource_center',
  BR_OUT_DELETE: 'branch_admin:outsource_centers__delete_outsource_center',

  BR_DR_ADD_REPORTING: 'branch_admin:reporting_doctors__add_reporting_doctor',
  BR_DR_UPDATE_REPORTING:
    'branch_admin:reporting_doctors__update_reporting_doctor',
  BR_DR_DELETE_REPORTING:
    'branch_admin:reporting_doctors__delete_reporting_doctor',
  BR_DR_ADD_CONSULTANT:
    'branch_admin:consultant_doctors__add_consultant_doctor',
  BR_DR_UPDATE_CONSULTANT:
    'branch_admin:consultant_doctors__update_consultant_doctor',
  BR_DR_DELETE_CONSULTANT:
    'branch_admin:consultant_doctors__delete_consultant_doctor',

  BR_REF_ADD_PANEL: 'branch_admin:referrals__add_referral_panel',
  BR_REF_UPDATE_PANEL: 'branch_admin:referrals__update_referral_panel',
  BR_REF_DELETE_PANEL: 'branch_admin:referrals__delete_referral_panel',
  BR_REF_ADD_DOCTOR: 'branch_admin:referrals__add_referral_doctor',
  BR_REF_UPDATE_DOCTOR: 'branch_admin:referrals__update_referral_doctor',
  BR_REF_DELETE_DOCTOR: 'branch_admin:referrals__delete_referral_doctor',
  BR_REF_ADD_EXTERNAL: 'branch_admin:referrals__add_external_referral_user',
  BR_REF_UPDATE_EXTERNAL:
    'branch_admin:referrals__update_external_referral_user',
  BR_REF_DELETE_EXTERNAL:
    'branch_admin:referrals__delete_external_referral_user',
  BR_REF_ADD_INTERNAL: 'branch_admin:referrals__add_internal_referral_user',
  BR_REF_UPDATE_INTERNAL:
    'branch_admin:referrals__update_internal_referral_user',
  BR_REF_DELETE_INTERNAL:
    'branch_admin:referrals__delete_internal_referral_user',

  BR_DOC_ADD: 'branch_admin:document_management__add_document',
  BR_DOC_UPDATE: 'branch_admin:document_management__update_document',
  BR_DOC_DELETE: 'branch_admin:document_management__delete_document',

  BR_UM_UPDATE_USERS:
    'branch_admin:user_management__update_users_for_assigned_branch',
  BR_UM_UPDATE_PERMISSIONS:
    'branch_admin:user_management__update_the_user_permissions_for_assigned_branch',

  BR_RPS_CREATE_CASH:
    'branch_admin:referral_panel_settings__create_cash_referral_panel_settings',
  BR_RPS_EDIT_CASH:
    'branch_admin:referral_panel_settings__edit_cash_referral_panel_settings',
  BR_RPS_DELETE_CASH:
    'branch_admin:referral_panel_settings__delete_cash_referral_panel_settings',
  BR_RPS_CREATE_CREDIT:
    'branch_admin:referral_panel_settings__create_credit_referral_panel_settings',
  BR_RPS_EDIT_CREDIT:
    'branch_admin:referral_panel_settings__edit_credit_referral_panel_settings',
  BR_RPS_DELETE_CREDIT:
    'branch_admin:referral_panel_settings__delete_credit_referral_panel_settings',
  BR_RPS_CREATE_PREPAID:
    'branch_admin:referral_panel_settings__create_prepaid_referral_panel_settings',
  BR_RPS_EDIT_PREPAID:
    'branch_admin:referral_panel_settings__edit_prepaid_referral_panel_settings',
  BR_RPS_DELETE_PREPAID:
    'branch_admin:referral_panel_settings__delete_prepaid_referral_panel_settings',

  BR_MACHINE_ADD: 'branch_admin:machines__add_machine',
  BR_MACHINE_EDIT: 'branch_admin:machines__edit_machine',
  BR_MACHINE_DELETE: 'branch_admin:machines__delete_machine',
} as const;

/** Laboratory resubmit is allowed from the Rejected OR Error-Reported queue. */
export const LAB_RESUBMIT_KEYS = [
  PERMISSION_KEYS.LAB_ACCESS_RESULT_REJECTED,
  PERMISSION_KEYS.LAB_ACCESS_ERROR_REPORTED,
] as const;

/**
 * Referral/outsource receiving-action key groups. The transfer endpoints
 * (pick-up / receive / accept / reject / repeat) are shared across INTERNAL /
 * EXTERNAL / OUTSOURCE kinds, so the controller asserts the caller holds the
 * action for at least one referral type (`assertAny`).
 */
export const ACCESSION_TRANSFER_KEY_GROUPS = {
  PICK_UP: [
    PERMISSION_KEYS.ACC_INT_PICKUP,
    PERMISSION_KEYS.ACC_EXT_PICKUP,
    PERMISSION_KEYS.ACC_OUT_PICKUP,
  ],
  RECEIVE: [
    PERMISSION_KEYS.ACC_INT_RECEIVE,
    PERMISSION_KEYS.ACC_EXT_RECEIVE,
    PERMISSION_KEYS.ACC_OUT_RECEIVE,
  ],
  ACCEPT: [
    PERMISSION_KEYS.ACC_INT_ACCEPT,
    PERMISSION_KEYS.ACC_EXT_ACCEPT,
    PERMISSION_KEYS.ACC_OUT_ACCEPT,
  ],
  REJECT: [
    PERMISSION_KEYS.ACC_INT_REJECT,
    PERMISSION_KEYS.ACC_EXT_REJECT,
    PERMISSION_KEYS.ACC_OUT_REJECT,
  ],
  REPEAT: [
    PERMISSION_KEYS.ACC_INT_REPEAT,
    PERMISSION_KEYS.ACC_EXT_REPEAT,
    PERMISSION_KEYS.ACC_OUT_REPEAT,
  ],
  ASSIGN_CENTER: [
    PERMISSION_KEYS.ACC_IH_ASSIGN_INTERNAL_CENTER,
    PERMISSION_KEYS.ACC_IH_ASSIGN_EXTERNAL_CENTER,
    PERMISSION_KEYS.ACC_IH_ASSIGN_OUTSOURCE_CENTER,
  ],
  UPDATE_CENTER: [
    PERMISSION_KEYS.ACC_IH_UPDATE_INTERNAL_CENTER,
    PERMISSION_KEYS.ACC_IH_UPDATE_EXTERNAL_CENTER,
    PERMISSION_KEYS.ACC_IH_UPDATE_OUTSOURCE_CENTER,
  ],
} as const;

/**
 * Admin write-endpoint key groups (`assertAny` semantics). Some Business/Branch
 * Admin resource controllers are shared across contexts or channels/types, so a
 * single write route maps to several catalogue keys and holding any one suffices:
 *
 * - **Documents** live under BOTH `business_admin` and `branch_admin` (either
 *   console may add/update/delete a document).
 * - **Doctors** — one `/doctors` registry backs both "Reporting" and
 *   "Consultant" doctor sections.
 * - **Lab panel update** — the catalogue carries two near-synonym keys
 *   ("Update lab panel" / "Edit the panel") for the one update route.
 * - **Templates** — a single `/templates` route serves SMS/email/WhatsApp/consent
 *   channels (the channel is a body field, not a route).
 * - **Referral panel settings** — one route serves cash/credit/prepaid types.
 * - **User update / permissions** — the write is available to both admin modules.
 * - **Branch links** — collection-mapping writes cover link/edit/delete-link.
 */
export const ADMIN_KEY_GROUPS = {
  DOC_ADD: [PERMISSION_KEYS.BA_DOC_ADD, PERMISSION_KEYS.BR_DOC_ADD],
  DOC_UPDATE: [PERMISSION_KEYS.BA_DOC_UPDATE, PERMISSION_KEYS.BR_DOC_UPDATE],
  DOC_DELETE: [PERMISSION_KEYS.BA_DOC_DELETE, PERMISSION_KEYS.BR_DOC_DELETE],

  DOCTOR_ADD: [
    PERMISSION_KEYS.BR_DR_ADD_CONSULTANT,
    PERMISSION_KEYS.BR_DR_ADD_REPORTING,
  ],
  DOCTOR_UPDATE: [
    PERMISSION_KEYS.BR_DR_UPDATE_CONSULTANT,
    PERMISSION_KEYS.BR_DR_UPDATE_REPORTING,
  ],
  DOCTOR_DELETE: [
    PERMISSION_KEYS.BR_DR_DELETE_CONSULTANT,
    PERMISSION_KEYS.BR_DR_DELETE_REPORTING,
  ],

  PANEL_UPDATE: [
    PERMISSION_KEYS.BA_MD_UPDATE_LAB_PANEL,
    PERMISSION_KEYS.BA_MD_EDIT_THE_PANEL,
  ],

  TEMPLATE_ADD: [
    PERMISSION_KEYS.BA_TPL_ADD_SMS,
    PERMISSION_KEYS.BA_TPL_ADD_EMAIL,
    PERMISSION_KEYS.BA_TPL_ADD_WHATSAPP,
    PERMISSION_KEYS.BA_TPL_ADD_CONSENT,
  ],
  TEMPLATE_EDIT: [
    PERMISSION_KEYS.BA_TPL_EDIT_SMS,
    PERMISSION_KEYS.BA_TPL_EDIT_EMAIL,
    PERMISSION_KEYS.BA_TPL_EDIT_WHATSAPP,
    PERMISSION_KEYS.BA_TPL_EDIT_CONSENT,
  ],
  TEMPLATE_DELETE: [
    PERMISSION_KEYS.BA_TPL_DELETE_SMS,
    PERMISSION_KEYS.BA_TPL_DELETE_EMAIL,
    PERMISSION_KEYS.BA_TPL_DELETE_WHATSAPP,
    PERMISSION_KEYS.BA_TPL_DELETE_CONSENT,
  ],

  RPS_CREATE: [
    PERMISSION_KEYS.BR_RPS_CREATE_CASH,
    PERMISSION_KEYS.BR_RPS_CREATE_CREDIT,
    PERMISSION_KEYS.BR_RPS_CREATE_PREPAID,
  ],
  RPS_EDIT: [
    PERMISSION_KEYS.BR_RPS_EDIT_CASH,
    PERMISSION_KEYS.BR_RPS_EDIT_CREDIT,
    PERMISSION_KEYS.BR_RPS_EDIT_PREPAID,
  ],
  RPS_DELETE: [
    PERMISSION_KEYS.BR_RPS_DELETE_CASH,
    PERMISSION_KEYS.BR_RPS_DELETE_CREDIT,
    PERMISSION_KEYS.BR_RPS_DELETE_PREPAID,
  ],

  USER_UPDATE: [
    PERMISSION_KEYS.BA_UM_UPDATE_USERS,
    PERMISSION_KEYS.BR_UM_UPDATE_USERS,
  ],
  USER_UPDATE_PERMISSIONS: [
    PERMISSION_KEYS.BA_UM_UPDATE_PERMISSIONS,
    PERMISSION_KEYS.BR_UM_UPDATE_PERMISSIONS,
  ],

  BRANCH_LINK: [
    PERMISSION_KEYS.BA_BRANCH_LINK,
    PERMISSION_KEYS.BA_BRANCH_EDIT_LINK,
    PERMISSION_KEYS.BA_BRANCH_DELETE_LINK,
  ],
} as const;

/** One action within a sub-section of the catalogue. */
export interface PermissionCatalogAction {
  permissionKey: string;
  label: string;
}

/** A sub-section group of a module in the catalogue. */
export interface PermissionCatalogSection {
  section: string;
  sectionLabel: string;
  permissions: PermissionCatalogAction[];
}

/** A module with its sub-sections (system catalogue, no user context). */
export interface PermissionCatalogModule {
  moduleKey: string;
  moduleLabel: string;
  sections: PermissionCatalogSection[];
}

/**
 * The full system permission catalogue, grouped module → sub-section → actions
 * (catalogue order). Pure static data derived from {@link PERMISSION_SPEC} — used
 * by admin permission editors to render the complete grid.
 */
export const PERMISSION_CATALOG_BY_MODULE: PermissionCatalogModule[] =
  Object.entries(PERMISSION_SPEC).map(([moduleKey, sections]) => ({
    moduleKey,
    moduleLabel: moduleLabel(moduleKey),
    sections: sections.map((sec) => {
      const sectionSlug = slug(sec.label);
      return {
        section: sectionSlug,
        sectionLabel: sec.label,
        permissions: sec.permissions.map((label) => ({
          permissionKey: `${moduleKey}:${sectionSlug}__${slug(label)}`,
          label,
        })),
      };
    }),
  }));

/** Permission keys belonging to a module, in catalogue order. */
export function modulePermissionKeys(moduleKey: string): string[] {
  return MODULE_PERMISSION_CATALOG.filter((e) => e.moduleKey === moduleKey).map(
    (e) => e.permissionKey,
  );
}

/**
 * Default modules each role is granted at baseline. A role's baseline permission
 * set is every permission key of these modules; per-(user+branch) and
 * per-(branch+role) rows then override individual keys. Re-exported from the
 * dedicated role→module access config so it can be edited independently.
 */
export const ROLE_DEFAULT_MODULES: Record<ProfileKey, string[]> =
  ROLE_MODULE_ACCESS;

/** Expand a list of module keys into all their permission keys (catalogue order). */
function expandModulePermissions(moduleKeys: string[]): string[] {
  const keys: string[] = [];
  for (const moduleKey of moduleKeys) {
    for (const k of modulePermissionKeys(moduleKey)) {
      keys.push(k);
    }
  }
  return keys;
}

/**
 * A predefined role template: two **independent** lists — the permissions it grants
 * and the modules it is linked to. `modules` may be empty (a template not linked to
 * any module). Each template is seeded so its permissions are the expansion of its
 * linked modules, but the two lists are independent and may be edited separately.
 */
export interface RoleTemplate {
  permissions: string[];
  modules: string[];
}

/** The predefined role templates, keyed by role (profile) key. */
export const ROLE_TEMPLATES: Record<ProfileKey, RoleTemplate> =
  Object.fromEntries(
    (Object.keys(ROLE_DEFAULT_MODULES) as ProfileKey[]).map((role) => {
      const modules = ROLE_DEFAULT_MODULES[role] ?? [];
      return [role, { modules, permissions: expandModulePermissions(modules) }];
    }),
  ) as Record<ProfileKey, RoleTemplate>;

/** The baseline permission keys granted to a role (its template's permission list). */
export function roleBaselinePermissions(roleKey: string): Set<string> {
  return new Set(ROLE_TEMPLATES[roleKey as ProfileKey]?.permissions ?? []);
}

/** The modules linked to a role template (may be empty = not linked to a module). */
export function roleTemplateModules(roleKey: string): string[] {
  return ROLE_TEMPLATES[roleKey as ProfileKey]?.modules ?? [];
}
