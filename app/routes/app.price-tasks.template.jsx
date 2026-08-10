import * as XLSX from "xlsx";
import { authenticate } from "../shopify.server";

export const config = { runtime: "nodejs" };

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  const rows = [
    { SKU: "ABC-001", "Target Price": 19.99 },
    { SKU: "ABC-002", "Target Price": 24.99 },
  ];
  const worksheet = XLSX.utils.json_to_sheet(rows, {
    header: ["SKU", "Target Price"],
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Price Task Template");

  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  return new Response(buffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition":
        'attachment; filename="compare-at-price-template.xlsx"',
    },
  });
};
