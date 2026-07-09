import type { AdvanceContextType, AdvanceDocument } from './types';

/**
 * Sample data + seed document for the Advance PDF editor previews.
 *
 * Site-admin templates are always previewed against **sample** data (there is
 * no bound order/lab-result at design time), so — unlike the reference
 * backend — we do not port the DB-backed context builders. `sampleContext`
 * supplies realistic fixture data keyed by the block token catalog, and
 * `defaultDocument` is the seed used when a new template is created without a
 * `doc`.
 */

/**
 * Map a stored template `type` (PDF_REPORT_TEMPLATE_TYPES) onto the advance
 * renderer's narrower `AdvanceContextType`. Invoice/bill-shaped templates use
 * the invoice fixture; everything else falls back to the richer lab-report
 * fixture.
 */
export function toAdvanceContextType(type: string): AdvanceContextType {
  if (type === 'invoice') return 'order_invoice';
  return 'lab_report';
}

/** Minimal viable document — used as the seed when a new template is created. */
export function defaultDocument(): AdvanceDocument {
  return {
    version: 1,
    page: {
      size: 'A4',
      orientation: 'portrait',
      margins: { top: '15mm', right: '12mm', bottom: '15mm', left: '12mm' },
      default_font: { family: 'Inter', size: 11, color: '#0f172a' },
    },
    theme: {
      colors: {
        brand: '#0ea5e9',
        muted: '#64748b',
        danger: '#ef4444',
        warning: '#f59e0b',
        success: '#10b981',
        bg: '#f8fafc',
        text: '#0f172a',
      },
      fonts: { heading: 'Inter', body: 'Inter' },
    },
    header: { height: '0mm', blocks: [] },
    footer: { height: '0mm', blocks: [] },
    body: {
      blocks: [
        {
          id: 'h1',
          type: 'heading',
          props: { level: 1, text: '{branch.name}' },
          style: { color: '#0ea5e9', font_size: 22, font_weight: 700 },
        },
        {
          id: 'p1',
          type: 'paragraph',
          props: {
            text: 'Welcome to your Advance PDF template. Edit blocks on the right.',
          },
          style: { color: '#64748b' },
        },
        { id: 'd1', type: 'divider', props: {} },
        {
          id: 'k1',
          type: 'kv',
          props: { label: 'Patient', value: '{patient.full_name}' },
        },
        {
          id: 'k2',
          type: 'kv',
          props: { label: 'Order #', value: '{order.display_id}' },
        },
      ],
    },
  };
}

/** Sample data for editor previews when no context is bound. */
export function sampleContext(
  contextType: AdvanceContextType,
): Record<string, unknown> {
  if (contextType === 'order_invoice' || contextType === 'order_bill') {
    return {
      branch: {
        name: 'Vision Pathology Lab',
        address: 'Pvr Prashant Vihar Rd, Rohini Delhi 110085',
        phone: '+91 8937866849',
        email: 'contact@visionpathology.in',
        logo: '',
      },
      patient: {
        full_name: 'Mr. Ashish Gautam',
        salutation: 'Mr.',
        age: '21 Yrs.',
        gender: 'M',
        registration_no: '0002VE029915',
        mobile: '+91 9876543210',
        email: 'ashish@example.com',
      },
      order: {
        id: 0,
        display_id: 'AB-12345',
        date: '12 Aug 2024',
        external_id: '',
        payment_method: 'cash',
        referring_panel: 'Apollo Diagnostics',
        referring_doctor: 'Dr. Sharma',
        note: '',
      },
      bill: {
        original: '1500.00',
        discount: '150.00',
        tax: '0.00',
        total: '1350.00',
        paid: '1350.00',
        balance: '0.00',
        status: 'Paid',
      },
      items: [
        {
          name: 'Liver Function Test',
          type: 'lab_test',
          quantity: 1,
          original_price: '800.00',
          price: '720.00',
          discount_amount: '80.00',
          discount_percentage: '10.00',
          tax: '0.00',
          total: '720.00',
        },
        {
          name: 'Lipid Profile',
          type: 'lab_test',
          quantity: 1,
          original_price: '700.00',
          price: '630.00',
          discount_amount: '70.00',
          discount_percentage: '10.00',
          tax: '0.00',
          total: '630.00',
        },
      ],
    };
  }
  return {
    branch: {
      name: 'Vision Pathology Lab',
      address: 'Pvr Prashant Vihar Rd, Sector 14, Rohini Delhi 110085',
      phone: '+91 8937866849',
      email: 'contact@visionpathology.in',
      logo: '',
    },
    patient: {
      full_name: 'Mr. Ashish Gautam',
      salutation: 'Mr.',
      age: '21 Yrs.',
      gender: 'M',
      registration_no: '0002VE029915',
    },
    order: {
      id: 0,
      display_id: 'AB-12345',
      date: '12 Aug 2024',
      external_id: '',
    },
    category_external_id: 'CAT-001',
    health_score: 78,
    organs: [
      { name: 'Lungs', status: 'normal' },
      { name: 'Heart', status: 'borderline' },
      { name: 'Liver', status: 'abnormal' },
      { name: 'Kidney', status: 'normal' },
    ],
    tests: [
      {
        id: 1,
        name: 'Liver Function Test (LFT)',
        category: 'Pathology',
        department: 'Liver',
        status: 'abnormal',
        results: [
          {
            name: 'Globulin Serum',
            value: '250',
            unit: 'mg/dL',
            status: 'abnormal',
            ref_low: 50,
            ref_normal_low: 50,
            ref_normal_high: 200,
            ref_high: 300,
            range: '50 - 200',
            abnormal_reason:
              'May be caused by infections or chronic inflammation.',
          },
          {
            name: 'A/G Ratio',
            value: '5',
            unit: '',
            status: 'abnormal',
            ref_low: 1,
            ref_normal_low: 1,
            ref_normal_high: 2,
            ref_high: 3,
            range: '1 - 2',
            abnormal_reason: 'Low ratio may indicate immune disorders.',
          },
          {
            name: 'Bilirubin Total',
            value: '1.5',
            unit: 'mg/dL',
            status: 'abnormal',
            ref_low: 0.1,
            ref_normal_low: 0.1,
            ref_normal_high: 1.2,
            ref_high: 5,
            range: '0.1 - 1.2',
            abnormal_reason:
              'May indicate liver disease or blocked bile ducts.',
          },
          {
            name: 'Protein Total',
            value: '7.4',
            unit: 'mg/dL',
            status: 'normal',
            ref_low: 6.6,
            ref_normal_low: 6.6,
            ref_normal_high: 8.3,
            ref_high: 9,
            range: '6.6 - 8.3',
            abnormal_reason: null,
          },
          {
            name: 'Albumin Serum',
            value: '7.4',
            unit: 'mg/dL',
            status: 'normal',
            ref_low: 6.6,
            ref_normal_low: 6.6,
            ref_normal_high: 8.3,
            ref_high: 9,
            range: '6.6 - 8.3',
            abnormal_reason: null,
          },
        ],
        normal_results: [
          {
            name: 'Protein Total',
            value: '7.4',
            unit: 'mg/dL',
            range: '6.6 - 8.3',
            status: 'normal',
          },
          {
            name: 'Albumin Serum',
            value: '7.4',
            unit: 'mg/dL',
            range: '6.6 - 8.3',
            status: 'normal',
          },
        ],
        abnormal_results: [
          {
            name: 'Globulin Serum',
            value: '250',
            unit: 'mg/dL',
            range: '50 - 200',
            status: 'abnormal',
          },
          {
            name: 'A/G Ratio',
            value: '5',
            unit: '',
            range: '1 - 2',
            status: 'abnormal',
          },
          {
            name: 'Bilirubin Total',
            value: '1.5',
            unit: 'mg/dL',
            range: '0.1 - 1.2',
            status: 'abnormal',
          },
        ],
      },
    ],
  };
}
