/**
 * Safe response shape for an outsource-center document. `filePath` (the
 * on-disk location) is intentionally never included — clients fetch bytes
 * only through the authenticated download endpoint.
 */
export interface OutsourceCenterDocumentEntity {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  createdAt: Date;
}
