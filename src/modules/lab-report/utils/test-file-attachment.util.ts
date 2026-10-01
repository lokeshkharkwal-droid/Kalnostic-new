import type { LabReportAttachment } from '@prisma/client';
import { escapeAttr } from '../../pdf-report-template/services/pdf-document.util';
import type { LabReportAttachmentKind } from '../dto/create-lab-report-attachment.dto';

/** The Test Entry bucket whose uploads the tag prints — the "File +" button. */
const FILE_BUCKET: LabReportAttachmentKind = 'file';

/** The attachment fields the tag reads. */
export type TestFileAttachment = Pick<
  LabReportAttachment,
  'kind' | 'fileUrl' | 'fileName' | 'uploadedAt'
>;

/** True when the file name or the URL path ends in `.pdf` (the row stores no MIME type). */
function isPdfAttachment(a: TestFileAttachment): boolean {
  const urlPath = a.fileUrl.split(/[?#]/)[0] ?? '';
  return /\.pdf$/i.test(a.fileName) || /\.pdf$/i.test(urlPath);
}

/**
 * Build the `{test_file_attachment}` print-tag value: one `<embed>` per PDF the
 * technician uploaded through the Test Entry "File +" button for THIS report
 * (`LabReportAttachment.kind === 'file'`), oldest first. A `LabReport` is one
 * test line of one order, so passing that report's own `attachments` is what
 * keeps the tag from ever showing another test's or order's file.
 *
 * Non-PDF "File +" uploads (sheets, docs, images) are skipped, since `<embed>`
 * can't print them. `PdfService` turns each `<embed>` into the PDF's real pages
 * at print time (Chromium alone prints a PDF embed as an empty box).
 * @param attachments the report's attachments (any order, any bucket)
 * @returns the HTML for the tag, or `''` when the test has no File+ PDF
 */
export function buildTestFileAttachmentHtml(
  attachments: TestFileAttachment[],
): string {
  return attachments
    .filter((a) => a.kind === FILE_BUCKET && isPdfAttachment(a))
    .sort((a, b) => a.uploadedAt.getTime() - b.uploadedAt.getTime())
    .map(
      (a) =>
        `<div class="test-file-attachment"><embed src="${escapeAttr(
          a.fileUrl,
        )}" type="application/pdf" title="${escapeAttr(
          a.fileName,
        )}" style="display:block;width:100%;height:120mm;border:0;" /></div>`,
    )
    .join('');
}
