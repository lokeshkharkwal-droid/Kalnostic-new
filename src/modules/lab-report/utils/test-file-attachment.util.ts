import type { LabReportAttachment } from '@prisma/client';
import { APPEND_MARKER_CLASS } from '../../pdf/pdf-append.util';
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

/**
 * Render one "File +" upload as a hidden "append" marker for the
 * `{test_file_attachment_without_header}` tag. Unlike
 * {@link renderTestFileAttachment} (which draws the file INSIDE the report), this
 * emits no visible content — a `display:none` placeholder carrying the file's URL
 * and name. After layout `PdfService` reads these markers and appends each file's
 * own pages to the END of the finished PDF (a PDF merged page-for-page as-is; an
 * image converted to one page), so the attachment extends the report instead of
 * being embedded in a page. Non-PDF/non-image uploads return `''` and are dropped,
 * exactly as {@link renderTestFileAttachment} drops them.
 */
function renderTestFileAttachmentAppendMarker(a: TestFileAttachment): string {
  if (
    !isPdfFileName(a.fileName, a.fileUrl) &&
    !isImageFileName(a.fileName, a.fileUrl)
  ) {
    return '';
  }
  return `<div class="${APPEND_MARKER_CLASS}" data-pdf-append-src="${escapeAttr(
    a.fileUrl,
  )}" data-pdf-append-name="${escapeAttr(a.fileName)}" style="display:none"></div>`;
}

/**
 * Build the `{test_file_attachment_without_header}` print-tag value: for each
 * "File +" upload on THIS report (`kind === 'file'`, oldest first, PDFs and
 * images), a hidden marker the PDF pipeline turns into APPENDED pages at the end
 * of the finished report — a PDF merged page-for-page, an image converted to one
 * page. It selects exactly the same uploads as {@link buildTestFileAttachmentHtml}
 * but appends them instead of embedding them inline (no `<embed>`/`<img>`), so a
 * 5-page report plus a 3-page attachment prints 8 pages.
 *
 * Built from this report's own attachments only, so — like its sibling — it can
 * never show another test's or order's file. Non-PDF/non-image File+ uploads are
 * skipped.
 * @param attachments the report's attachments (any order, any bucket)
 * @returns the marker HTML for the tag, or `''` when the test has no PDF/image File+ upload
 */
export function buildTestFileAttachmentAppendHtml(
  attachments: TestFileAttachment[],
): string {
  return attachments
    .filter((a) => a.kind === FILE_BUCKET)
    .sort((a, b) => a.uploadedAt.getTime() - b.uploadedAt.getTime())
    .map(renderTestFileAttachmentAppendMarker)
    .filter((html) => html !== '')
    .join('');
}
