import type { LabReportAttachment } from '@prisma/client';
import { escapeAttr } from '../../pdf-report-template/services/pdf-document.util';
import type { LabReportAttachmentKind } from '../dto/create-lab-report-attachment.dto';
import { isImageFileName, isPdfFileName } from './pdf-file.util';

/** The Test Entry bucket whose uploads the tag prints — the "File +" button. */
const FILE_BUCKET: LabReportAttachmentKind = 'file';

/** The attachment fields the tag reads. */
export type TestFileAttachment = Pick<
  LabReportAttachment,
  'kind' | 'fileUrl' | 'fileName' | 'uploadedAt'
>;

/**
 * Render one "File +" upload for the tag: a PDF as an `<embed>` (turned into its
 * real pages at print time by `PdfService` — Chromium alone prints a PDF embed
 * as an empty box), an image as an `<img>` (rendered natively by Chromium, the
 * same way any other body image like `patient_image` is). Anything else returns
 * `''` and is dropped (nothing to render).
 */
function renderTestFileAttachment(a: TestFileAttachment): string {
  if (isPdfFileName(a.fileName, a.fileUrl)) {
    return `<div class="test-file-attachment"><embed src="${escapeAttr(
      a.fileUrl,
    )}" type="application/pdf" title="${escapeAttr(
      a.fileName,
    )}" style="display:block;width:100%;height:120mm;border:0;" /></div>`;
  }
  if (isImageFileName(a.fileName, a.fileUrl)) {
    // `break-inside:avoid` keeps the image on one page; `max-height` caps a tall
    // (portrait) image to the page so it scales to fit instead of overflowing /
    // being split, while `max-width:100%` caps a wide one. Aspect ratio is kept
    // because width/height are `auto`.
    return `<div class="test-file-attachment" style="break-inside:avoid;page-break-inside:avoid;"><img src="${escapeAttr(
      a.fileUrl,
    )}" alt="${escapeAttr(
      a.fileName,
    )}" style="display:block;width:auto;height:auto;max-width:100%;max-height:240mm;margin:0 auto;" /></div>`;
  }
  return '';
}

/**
 * Build the `{test_file_attachment}` print-tag value: the files the technician
 * uploaded through the Test Entry "File +" button for THIS report
 * (`LabReportAttachment.kind === 'file'`), oldest first — each PDF as an
 * `<embed>` and each image as an `<img>`. A `LabReport` is one test line of one
 * order, so passing that report's own `attachments` is what keeps the tag from
 * ever showing another test's or order's file.
 *
 * Non-PDF/non-image "File +" uploads are skipped (nothing the tag can render).
 * @param attachments the report's attachments (any order, any bucket)
 * @returns the HTML for the tag, or `''` when the test has no renderable File+ upload
 */
export function buildTestFileAttachmentHtml(
  attachments: TestFileAttachment[],
): string {
  return attachments
    .filter((a) => a.kind === FILE_BUCKET)
    .sort((a, b) => a.uploadedAt.getTime() - b.uploadedAt.getTime())
    .map(renderTestFileAttachment)
    .filter((html) => html !== '')
    .join('');
}
