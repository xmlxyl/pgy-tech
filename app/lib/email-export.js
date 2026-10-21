import * as XLSX from "xlsx";

/** @param {Date | string} value */
export function formatExportDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleString("zh-CN", { hour12: false });
}

/** @param {string} value */
function escapeCsvField(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/** @typedef {{ email: string, username?: string | null, type?: string | null, createdAt: Date | string }} EmailExportRow */

/** @param {EmailExportRow[]} rows */
export function buildEmailCsv(rows) {
  const header = ["邮箱", "用户名", "活动类型", "提交时间"];
  const lines = [
    header.join(","),
    ...rows.map((row) =>
      [
        escapeCsvField(row.email),
        escapeCsvField(row.username ?? ""),
        escapeCsvField(row.type ?? ""),
        escapeCsvField(formatExportDate(row.createdAt)),
      ].join(","),
    ),
  ];
  return `\uFEFF${lines.join("\r\n")}`;
}

/** @param {EmailExportRow[]} rows */
export function buildEmailXlsxBytes(rows) {
  const sheetRows = rows.map((row) => ({
    邮箱: row.email,
    用户名: row.username ?? "",
    活动类型: row.type ?? "",
    提交时间: formatExportDate(row.createdAt),
  }));
  const worksheet = XLSX.utils.json_to_sheet(sheetRows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "邮箱记录");
  return XLSX.write(workbook, { type: "array", bookType: "xlsx" });
}

/** @param {"csv" | "xlsx"} format */
export function emailExportFilename(format) {
  const date = new Date().toISOString().slice(0, 10);
  return `email-records-${date}.${format === "csv" ? "csv" : "xlsx"}`;
}

/** @param {BlobPart} data @param {string} filename @param {string} mimeType */
function triggerDownload(data, filename, mimeType) {
  const blob =
    data instanceof Blob ? data : new Blob([data], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** @typedef {{ email: string, productTitle?: string, variantTitle?: string, productId?: string, variantId?: string, createdAt: Date | string }} RestockExportRow */

/** @param {RestockExportRow[]} rows */
export function buildRestockCsv(rows) {
  const header = ["邮箱", "产品", "规格", "产品ID", "规格ID", "提交时间"];
  const lines = [
    header.join(","),
    ...rows.map((row) =>
      [
        escapeCsvField(row.email),
        escapeCsvField(row.productTitle ?? ""),
        escapeCsvField(row.variantTitle ?? ""),
        escapeCsvField(row.productId ?? ""),
        escapeCsvField(row.variantId ?? ""),
        escapeCsvField(formatExportDate(row.createdAt)),
      ].join(","),
    ),
  ];
  return `\uFEFF${lines.join("\r\n")}`;
}

/** @param {RestockExportRow[]} rows */
export function downloadRestockCsv(rows) {
  const date = new Date().toISOString().slice(0, 10);
  triggerDownload(
    buildRestockCsv(rows),
    `restock-notify-${date}.csv`,
    "text/csv;charset=utf-8",
  );
}

/** @param {EmailExportRow[]} rows @param {"csv" | "xlsx"} format */
export function downloadEmailExport(rows, format) {
  const filename = emailExportFilename(format);

  if (format === "csv") {
    triggerDownload(buildEmailCsv(rows), filename, "text/csv;charset=utf-8");
    return;
  }

  triggerDownload(
    buildEmailXlsxBytes(rows),
    filename,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
}
