declare module "pdf-parse" {
  type PdfParseOptions = {
    max?: number;
  };

  type PdfParseResult = {
    info?: unknown;
    text?: string;
  };

  export default function pdfParse(
    data: Buffer,
    options?: PdfParseOptions
  ): Promise<PdfParseResult>;
}
