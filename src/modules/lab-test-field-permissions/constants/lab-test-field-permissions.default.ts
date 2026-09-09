/**
 * Canonical section → field registry for "Lab Test Master Setting"
 * (Business Settings › Lab Test Master Setting). Every field defaults to
 * Allowed (`true`); a tenant only ever stores the fields it has *denied*.
 *
 * Section/field label strings here are the shared contract with the frontend
 * (`kaltros-fe/src/pages/business-admin/LabTestMasterSetting`) — do not rename
 * without updating both sides.
 */
export type LabTestFieldPermissionsMap = Record<
  string,
  Record<string, boolean>
>;

const allTrue = (fields: string[]): Record<string, boolean> =>
  Object.fromEntries(fields.map((f) => [f, true]));

export const DEFAULT_LAB_TEST_FIELD_PERMISSIONS: LabTestFieldPermissionsMap = {
  'Basic Details': allTrue([
    'Test Name',
    'Test Display Name',
    'Test Code',
    'AKA',
    'Department',
    'Category',
    'Subcategory',
    'Processing Method',
    'ICD Code',
    'LOINC Code',
    'Clinical Tags',
    'Report Template',
    'Sample Priority Type',
    'PDF Setting',
    'Image Setting',
    'Enable CMS',
    'Approval Workflow',
    'Mandatory Test',
    'Hide in Order Screen',
    'Repeat Interval Restriction',
  ]),
  Pricing: allTrue([
    'Price MSRP',
    'Price Maximum',
    'Price Minimum',
    'Price Original',
    'Franchise Price',
    'Emergency Price',
    'Discount Cap',
    'Allow Price Override',
  ]),
  TAT: allTrue([
    'TAT Minimum',
    'TAT Maximum',
    'Scheduled Days',
    'Scheduled Time From',
    'Scheduled Time To',
    'Processing Time Minimum',
    'Processing Time Maximum',
    'Approval Time Minimum',
    'Approval Time Maximum',
    'Reporting Time From',
    'Reporting Time To',
  ]),
  Flags: allTrue([
    'Bill Only Test',
    'Allow Discounts',
    'Outsource',
    'Preference Test',
    'Sample Flow',
    'Test Status',
  ]),
  Sample: allTrue([
    'Sample Name',
    'Sample Type',
    'Container Type',
    'Sample Size',
    'Collection Method',
    'Number of Samples',
    'Stability',
    'Transport Temperature',
    'Preservative',
    'Sample Handling Instructions',
    'Fasting Required',
    'Light Protection',
    'Set as Default',
  ]),
  Results: allTrue([
    // Group Settings
    'Group Name',
    'Group Layout',
    'Group Settings',
    // Parameter Settings
    'Parameter Name',
    'Parameter Code',
    'Method',
    'Reporting Unit',
    'Result Type',
    'Parameter Type',
    'NABL',
    'CAP',
    'Result Rounding Type',
    'Icon Settings',
    'Image Settings',
    'Reflex Test',
    'Calculation Formula',
    'Allowable Units',
    'Notes',
  ]),
  'Reference Range': allTrue([
    'Parameter Name',
    'Method',
    'Gender',
    'Age From',
    'Age From Unit',
    'Age To',
    'Age To Unit',
    'Lower Limit',
    'Upper Limit',
    'Critical Minimum',
    'Critical Maximum',
    'Display of Reference Range',
    'Abnormal Flag Logic',
  ]),
  'Reference Value': allTrue([
    'Parameter Name',
    'Method',
    'Gender',
    'Age From',
    'Age From Unit',
    'Age To',
    'Age To Unit',
    'Display of Reference Value',
    'Abnormal Flag Logic',
  ]),
  'Version Control': allTrue([
    'Version',
    'Effective From',
    'Effective To',
    'Change Reason',
    'Modified By',
    'Approved By',
  ]),
};
