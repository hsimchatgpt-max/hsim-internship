import writeExcelFile from "write-excel-file/node";

/** Builds an .xlsx workbook. Text is always stored as text, so spreadsheet formulas in data are never evaluated. */
export async function toXlsx(sheet: string, headers: string[], rows: unknown[][]): Promise<Buffer> {
  const head = headers.map((h) => ({ value: h, type: String, fontWeight: "bold" as const }));
  const body = rows.map((r) =>
    r.map((v) => {
      if (v === null || v === undefined || v === "") return null;
      return typeof v === "number" ? { value: v, type: Number } : { value: String(v), type: String };
    }),
  );
  return writeExcelFile([head, ...body] as never, { sheet, columns: headers.map((h) => ({ width: Math.max(12, Math.min(40, h.length + 4)) })) } as never).toBuffer();
}
