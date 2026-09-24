import * as XLSX from "xlsx";

export const COUPON_NAMESPACE = "custom";
export const COUPON_CODE_KEY = "coupon_code";
export const COUPON_CODE_BY_PROMP_KEY = "coupon_code_by_promp";

const DELETE_MODES = {
  promp: [COUPON_CODE_BY_PROMP_KEY],
  product: [COUPON_CODE_BY_PROMP_KEY, COUPON_CODE_KEY],
};

const DELETE_PAGE_SIZE = 100;
const DELETE_PAGES_PER_REQUEST = 3;
const DELETE_TIME_BUDGET_MS = 8000;
const METAFIELD_MUTATION_LIMIT = 25;
const VARIANT_PAGE_SIZE = 50;
const MAX_VARIANT_PAGES = 20;
const DEFAULT_COUPON_TYPE = "single_line_text_field";
const MAX_COUPON_LENGTH = 255;

export async function parseCouponExcel(file) {
  if (!(file instanceof File) || !file.name) {
    return { ok: false, rows: [], message: "请上传 Excel 文件" };
  }
  if (!/\.(xlsx|xls)$/i.test(file.name)) {
    return { ok: false, rows: [], message: "仅支持 .xlsx 或 .xls 文件" };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  return parseCouponWorkbookBuffer(buffer, file.name);
}

export function parseCouponWorkbookBuffer(buffer, fileName = "coupon-codes.xlsx") {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) {
    return { ok: false, rows: [], message: "Excel 文件没有可读取的 Sheet" };
  }

  const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
  const seenSkus = new Set();
  const rows = [];

  rawRows.forEach((row, index) => {
    const sku = String(pickCell(row, ["sku"]) || "").trim();
    const couponCode = String(pickCell(row, ["couponcode", "coupon"]) || "").trim();
    if (!sku && !couponCode) return;

    const errors = [];
    if (!sku) errors.push("SKU 不能为空");
    if (!couponCode) errors.push("Coupon Code 不能为空");
    if (couponCode.length > MAX_COUPON_LENGTH) {
      errors.push(`Coupon Code 不能超过 ${MAX_COUPON_LENGTH} 个字符`);
    }

    const skuKey = sku.toLowerCase();
    if (sku && seenSkus.has(skuKey)) errors.push("Excel 中存在重复 SKU");
    if (sku) seenSkus.add(skuKey);

    rows.push({
      lineNumber: index + 2,
      sku,
      couponCode,
      errors,
    });
  });

  if (rows.length === 0) {
    return { ok: false, rows: [], message: "Excel 中没有可读取的 SKU 数据" };
  }

  return { ok: true, rows, fileName, message: "" };
}

export async function matchCouponSkus(admin, items) {
  const results = [];

  for (const item of items) {
    const sku = String(item?.sku || "").trim();
    const lineNumber = Number(item?.lineNumber) || 0;
    if (!sku) {
      results.push({ lineNumber, sku, variants: [], error: "SKU 不能为空" });
      continue;
    }

    const found = await findVariantsBySku(admin, sku);
    if (!found.ok) {
      return { ok: false, message: found.message, results };
    }

    results.push({
      lineNumber,
      sku,
      variants: found.error ? [] : found.variants,
      error: found.error || (found.variants.length ? "" : `SKU ${sku} 不存在`),
    });
  }

  return { ok: true, results, message: "" };
}

export async function importCouponCodes(admin, items) {
  const batch = (Array.isArray(items) ? items : [])
    .map((item) => ({
      ownerId: String(item?.ownerId || "").trim(),
      sku: String(item?.sku || "").trim(),
      couponCode: String(item?.couponCode || "").trim(),
      productTitle: String(item?.productTitle || "").trim(),
    }))
    .filter((item) => item.ownerId && item.couponCode)
    .slice(0, 50);

  if (batch.length === 0) {
    return { ok: false, message: "没有可写入的变体", successCount: 0, failed: [] };
  }

  const metafieldType = await getCouponMetafieldType(admin);
  let successCount = 0;
  const failed = [];

  for (const chunk of chunkItems(batch, METAFIELD_MUTATION_LIMIT)) {
    const response = await adminGraphql(
      admin,
      `#graphql
        mutation SetCouponMetafields($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            metafields { id }
            userErrors { field message }
          }
        }`,
      {
        metafields: chunk.map((item) => ({
          ownerId: item.ownerId,
          namespace: COUPON_NAMESPACE,
          key: COUPON_CODE_KEY,
          type: metafieldType,
          value: item.couponCode,
        })),
      },
    );

    if (!response.ok) {
      failed.push(
        ...chunk.map((item) => ({
          sku: item.sku,
          productTitle: item.productTitle,
          message: response.message,
        })),
      );
      continue;
    }

    const result = response.json.data?.metafieldsSet;
    const userErrors = result?.userErrors || [];
    const failedIndexes = new Set();

    userErrors.forEach((error) => {
      const index = Number(error.field?.[1]);
      if (!Number.isInteger(index) || !chunk[index] || failedIndexes.has(index)) return;
      failedIndexes.add(index);
      failed.push({
        sku: chunk[index].sku,
        productTitle: chunk[index].productTitle,
        message: error.message,
      });
    });

    if (userErrors.length && failedIndexes.size === 0) {
      successCount += result?.metafields?.filter(Boolean).length || 0;
      failed.push({
        sku: "",
        productTitle: "",
        message: userErrors.map((error) => error.message).join("；"),
      });
      continue;
    }

    successCount += chunk.length - failedIndexes.size;
  }

  return {
    ok: failed.length === 0,
    message: failed.length ? "部分 Coupon Code 写入失败" : "",
    successCount,
    failed,
  };
}

export async function deleteCouponMetafields(admin, mode, cursor) {
  const keys = DELETE_MODES[mode];
  if (!keys) {
    return {
      ok: false,
      message: "删除类型无效",
      scanned: 0,
      deleted: 0,
      errors: [],
      hasNextPage: false,
    };
  }

  let pageCursor = cursor || null;
  let hasNextPage = true;
  let scanned = 0;
  let deleted = 0;
  const errors = [];
  const startedAt = Date.now();
  let pages = 0;

  while (
    hasNextPage &&
    pages < DELETE_PAGES_PER_REQUEST &&
    Date.now() - startedAt < DELETE_TIME_BUDGET_MS
  ) {
    const page = await fetchVariantMetafieldPage(admin, pageCursor);
    if (!page.ok) {
      return {
        ok: false,
        message: page.message,
        cursor: pageCursor,
        hasNextPage: true,
        scanned,
        deleted,
        errors,
      };
    }

    pages += 1;
    scanned += page.nodes.length;
    const requestCursor = pageCursor;
    hasNextPage = page.hasNextPage;
    pageCursor = page.cursor;

    if (hasNextPage && (!pageCursor || pageCursor === requestCursor)) {
      errors.push("变体分页没有继续，删除已停止");
      hasNextPage = false;
    }

    const identifiers = page.nodes.flatMap((node) =>
      keys
        .filter((key) => node.metafields[key])
        .map((key) => ({
          ownerId: node.id,
          namespace: COUPON_NAMESPACE,
          key,
        })),
    );
    const deletion = await deleteMetafieldIdentifiers(admin, identifiers);
    deleted += deletion.deleted;
    errors.push(...deletion.errors);

    if (!deletion.ok) {
      return {
        ok: false,
        message: deletion.message,
        cursor: pageCursor,
        hasNextPage,
        scanned,
        deleted,
        errors,
      };
    }

    if (page.nodes.length === 0) hasNextPage = false;
  }

  return {
    ok: true,
    message: "",
    cursor: pageCursor,
    hasNextPage,
    scanned,
    deleted,
    errors: uniqueMessages(errors).slice(0, 10),
  };
}

async function findVariantsBySku(admin, sku) {
  const variants = [];
  const seenIds = new Set();
  let cursor = null;
  let hasNextPage = true;
  let pages = 0;

  while (hasNextPage && pages < MAX_VARIANT_PAGES) {
    const response = await adminGraphql(
      admin,
      `#graphql
        query CouponVariantsBySku($query: String!, $cursor: String) {
          productVariants(first: ${VARIANT_PAGE_SIZE}, after: $cursor, query: $query) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id
              sku
              title
              product { id title }
            }
          }
        }`,
      { query: skuSearchQuery(sku), cursor },
    );

    if (!response.ok) return { ok: false, message: response.message, variants: [] };

    const connection = response.json.data?.productVariants;
    const nodes = connection?.nodes || [];
    nodes.forEach((node) => {
      if (!sameSku(node.sku, sku) || seenIds.has(node.id)) return;
      seenIds.add(node.id);
      variants.push({
        id: node.id,
        sku: node.sku,
        title: node.title || "",
        productId: node.product?.id || "",
        productTitle: node.product?.title || "",
      });
    });

    hasNextPage = Boolean(connection?.pageInfo?.hasNextPage);
    cursor = connection?.pageInfo?.endCursor || null;
    pages += 1;
    if (nodes.length === 0) hasNextPage = false;
  }

  if (hasNextPage) {
    return {
      ok: true,
      variants: [],
      error: `SKU ${sku} 匹配到的变体过多，请拆分后重试`,
    };
  }

  return { ok: true, variants, error: "" };
}

export async function listExistingCouponMetafields(admin, cursor) {
  let pageCursor = cursor || null;
  let hasNextPage = true;
  let scanned = 0;
  const rows = [];
  const startedAt = Date.now();
  let pages = 0;

  while (
    hasNextPage &&
    pages < DELETE_PAGES_PER_REQUEST &&
    Date.now() - startedAt < DELETE_TIME_BUDGET_MS
  ) {
    const page = await fetchVariantCouponValuesPage(admin, pageCursor);
    if (!page.ok) {
      return {
        ok: false,
        message: page.message,
        cursor: pageCursor,
        hasNextPage: true,
        scanned,
        rows,
      };
    }

    pages += 1;
    scanned += page.nodes.length;
    const requestCursor = pageCursor;
    hasNextPage = page.hasNextPage;
    pageCursor = page.cursor;

    if (hasNextPage && (!pageCursor || pageCursor === requestCursor)) {
      hasNextPage = false;
    }

    page.nodes.forEach((node) => {
      rows.push({
        id: node.id,
        sku: node.sku || "",
        title: node.title || "",
        productTitle: node.productTitle || "",
        couponCode: node.couponCode || "",
      });
    });

    if (page.nodes.length === 0) hasNextPage = false;
  }

  return {
    ok: true,
    message: "",
    cursor: pageCursor,
    hasNextPage,
    scanned,
    rows,
  };
}

async function fetchVariantCouponValuesPage(admin, cursor) {
  const response = await adminGraphql(
    admin,
    `#graphql
      query CouponVariantValuesPage($cursor: String) {
        productVariants(first: ${DELETE_PAGE_SIZE}, after: $cursor, sortKey: ID) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            sku
            title
            product { title }
            couponCode: metafield(namespace: "${COUPON_NAMESPACE}", key: "${COUPON_CODE_KEY}") {
              value
            }
          }
        }
      }`,
    { cursor },
  );

  if (!response.ok) return response;

  const connection = response.json.data?.productVariants;
  return {
    ok: true,
    nodes: (connection?.nodes || []).map((node) => ({
      id: node.id,
      sku: node.sku || "",
      title: node.title || "",
      productTitle: node.product?.title || "",
      couponCode: node.couponCode?.value || "",
    })),
    hasNextPage: Boolean(connection?.pageInfo?.hasNextPage),
    cursor: connection?.pageInfo?.endCursor || null,
  };
}

async function fetchVariantMetafieldPage(admin, cursor) {
  const response = await adminGraphql(
    admin,
    `#graphql
      query CouponVariantMetafieldPage($cursor: String) {
        productVariants(first: ${DELETE_PAGE_SIZE}, after: $cursor, sortKey: ID) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            couponCode: metafield(namespace: "${COUPON_NAMESPACE}", key: "${COUPON_CODE_KEY}") {
              id
            }
            couponCodeByPromp: metafield(
              namespace: "${COUPON_NAMESPACE}"
              key: "${COUPON_CODE_BY_PROMP_KEY}"
            ) {
              id
            }
          }
        }
      }`,
    { cursor },
  );

  if (!response.ok) return response;

  const connection = response.json.data?.productVariants;
  return {
    ok: true,
    nodes: (connection?.nodes || []).map((node) => ({
      id: node.id,
      metafields: {
        [COUPON_CODE_KEY]: Boolean(node.couponCode?.id),
        [COUPON_CODE_BY_PROMP_KEY]: Boolean(node.couponCodeByPromp?.id),
      },
    })),
    hasNextPage: Boolean(connection?.pageInfo?.hasNextPage),
    cursor: connection?.pageInfo?.endCursor || null,
  };
}

async function deleteMetafieldIdentifiers(admin, identifiers) {
  let deleted = 0;
  const errors = [];

  for (const chunk of chunkItems(identifiers, METAFIELD_MUTATION_LIMIT)) {
    const response = await adminGraphql(
      admin,
      `#graphql
        mutation DeleteCouponMetafields($metafields: [MetafieldIdentifierInput!]!) {
          metafieldsDelete(metafields: $metafields) {
            deletedMetafields { ownerId namespace key }
            userErrors { field message }
          }
        }`,
      { metafields: chunk },
    );

    if (!response.ok) {
      return { ok: false, message: response.message, deleted, errors };
    }

    const result = response.json.data?.metafieldsDelete;
    deleted += result?.deletedMetafields?.filter(Boolean).length || 0;
    errors.push(...(result?.userErrors || []).map((error) => error.message));
  }

  return { ok: true, deleted, errors };
}

async function getCouponMetafieldType(admin) {
  const response = await adminGraphql(
    admin,
    `#graphql
      query CouponCodeMetafieldDefinition {
        metafieldDefinitions(
          first: 1
          ownerType: PRODUCTVARIANT
          namespace: "${COUPON_NAMESPACE}"
          key: "${COUPON_CODE_KEY}"
        ) {
          nodes { type { name } }
        }
      }`,
  );

  return (
    response.json?.data?.metafieldDefinitions?.nodes?.[0]?.type?.name ||
    DEFAULT_COUPON_TYPE
  );
}

async function adminGraphql(admin, query, variables) {
  try {
    const response = await admin.graphql(query, { variables });
    const json = await response.json();
    if (json.errors?.length) {
      return {
        ok: false,
        message: json.errors.map((error) => error.message).join("；"),
        json,
      };
    }
    return { ok: true, json };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      json: null,
    };
  }
}

function pickCell(row, normalizedKeys) {
  const entry = Object.entries(row).find(([key]) =>
    normalizedKeys.includes(normalizeHeader(key)),
  );
  return entry ? entry[1] : "";
}

function normalizeHeader(value) {
  return String(value).trim().toLowerCase().replace(/[\s_]+/g, "");
}

function skuSearchQuery(sku) {
  const escaped = String(sku).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `sku:"${escaped}"`;
}

function sameSku(left, right) {
  return String(left || "").trim().toLowerCase() === String(right || "").trim().toLowerCase();
}

function chunkItems(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function uniqueMessages(messages) {
  return [...new Set(messages.filter(Boolean))];
}
