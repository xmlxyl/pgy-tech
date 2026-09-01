import prisma from "../db.server";
import { authenticate } from "../shopify.server";

export const MANUAL_PROXY_PATH = "/apps/pgy-tech/manuals";

export const MANUAL_PRODUCT_SERIES = [
  "Bags",
  "Camera Gear",
  "Phone Gear",
  "Action & Pocket",
];

export const MANUAL_PAGE_SIZE = 20;

export function hasManualModel() {
  return Boolean(prisma.userManual);
}

export function isMissingManualTableError(error) {
  return (
    error?.code === "P2021" ||
    error?.code === "P2022" ||
    String(error?.message || "").includes("UserManual")
  );
}

export function normalizeManualSeries(value) {
  const series = String(value || "").trim();
  return MANUAL_PRODUCT_SERIES.includes(series) ? series : "";
}

export function normalizeManualSku(value) {
  return String(value || "")
    .split(/[\n,，;；]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .join(", ");
}

export function serializeManual(row) {
  return {
    id: row.id,
    title: row.title || row.fileName,
    fileName: row.fileName,
    sku: row.sku,
    productSeries: row.productSeries,
    fileId: row.fileId,
    fileUrl: row.fileUrl,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listManualFiles(admin, query = "") {
  const search = String(query || "").trim();
  const response = await admin.graphql(
    `#graphql
      query ManualFiles($first: Int!, $query: String) {
        files(first: $first, query: $query, sortKey: CREATED_AT, reverse: true) {
          nodes {
            id
            alt
            createdAt
            fileStatus
            preview {
              image {
                url(transform: { maxWidth: 120, maxHeight: 120 })
              }
            }
            ... on GenericFile {
              url
              mimeType
              originalFileSize
            }
            ... on MediaImage {
              image {
                url
              }
            }
          }
        }
      }`,
    {
      variables: {
        first: 50,
        query: search ? search : null,
      },
    },
  );
  const json = await response.json();
  if (json.errors?.length) {
    console.error("[manual-files]", JSON.stringify(json.errors, null, 2));
  }

  return (json.data?.files?.nodes || [])
    .map((file) => {
      const url = file.url || file.image?.url || file.preview?.image?.url || "";
      return {
        id: file.id,
        alt: file.alt || "",
        fileName: fileNameFromUrl(url) || file.alt || file.id.split("/").pop(),
        fileUrl: url,
        previewUrl: file.preview?.image?.url || file.image?.url || "",
        mimeType: file.mimeType || "",
        fileStatus: file.fileStatus || "",
        originalFileSize: file.originalFileSize || "",
        createdAt: file.createdAt || "",
      };
    })
    .filter((file) => file.fileUrl);
}

export async function resolveManualProxyShop(request) {
  try {
    const { session } = await authenticate.public.appProxy(request);
    const shop = session?.shop || new URL(request.url).searchParams.get("shop");
    if (!shop) {
      return { ok: false, message: "Unable to identify shop." };
    }
    return { ok: true, shop };
  } catch (error) {
    if (error instanceof Response) {
      return { ok: false, message: "App Proxy validation failed." };
    }
    throw error;
  }
}

export function buildManualWhere(shop, { query = "", series = "" } = {}) {
  const q = String(query || "").trim();
  const productSeries = normalizeManualSeries(series);
  return {
    shop,
    ...(productSeries ? { productSeries } : {}),
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { fileName: { contains: q, mode: "insensitive" } },
            { sku: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

function fileNameFromUrl(url) {
  if (!url) return "";
  try {
    const pathname = new URL(url).pathname;
    return decodeURIComponent(pathname.split("/").filter(Boolean).pop() || "");
  } catch {
    return String(url).split("/").filter(Boolean).pop() || "";
  }
}
