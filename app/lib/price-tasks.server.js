import * as XLSX from "xlsx";
import prisma from "../db.server";

export const TASK_STATUS = {
  pending: "Pending",
  priceChanging: "PriceChanging",
  priceChanged: "PriceChanged",
  restoring: "Restoring",
  completed: "Completed",
  partiallyFailed: "PartiallyFailed",
  failed: "Failed",
  cancelled: "Cancelled",
};

const ITEM_STATUS = {
  pending: "Pending",
  success: "Success",
  failed: "Failed",
  skipped: "Skipped",
};

const FEISHU_WEBHOOK_URL =
  "https://open.feishu.cn/open-apis/bot/v2/hook/a61ad8ea-fc5b-4e7f-8af4-9cfe16e9a9a7";

export const BEIJING_TIME_ZONE = "Asia/Shanghai";

export function formatBeijingDateTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: BEIJING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export async function parsePriceTaskExcel(file) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];

  if (!sheet) {
    return { rows: [], errors: ["Excel 文件没有可读取的 Sheet"] };
  }

  const rawRows = XLSX.utils.sheet_to_json(sheet, {
    defval: "",
    raw: false,
  });
  const seenKeys = new Set();
  const rows = [];
  const errors = [];

  rawRows.forEach((row, index) => {
    const lineNumber = index + 2;
    const sku = String(row.SKU ?? row.sku ?? "").trim();
    const productName = String(
      row["产品名称"] ??
        row["Product Name"] ??
        row.productName ??
        row.productTitle ??
        "",
    ).trim();
    const priceText = String(
      row["Target Price"] ?? row.targetPrice ?? row.price ?? "",
    ).trim();
    const rowErrors = [];

    if (!sku) rowErrors.push("SKU 不能为空");
    if (!priceText) rowErrors.push("Target Price 不能为空");

    const targetPrice = Number(priceText);
    if (priceText && (!Number.isFinite(targetPrice) || targetPrice < 0)) {
      rowErrors.push("Target Price 必须是大于等于 0 的数字");
    }

    const rowKey = `${sku.toLowerCase()}::${productName.toLowerCase()}`;
    if (sku && seenKeys.has(rowKey)) {
      rowErrors.push(
        productName
          ? "Excel 中存在相同 SKU 和产品名称的重复行"
          : "Excel 中存在重复 SKU（同一 SKU 对应多个产品时请填写产品名称）",
      );
    }
    if (sku) seenKeys.add(rowKey);

    if (!sku && !priceText && !productName) return;

    if (rowErrors.length) {
      errors.push(`第 ${lineNumber} 行：${rowErrors.join("；")}`);
    }

    rows.push({
      lineNumber,
      sku,
      productName,
      targetPrice: Number.isFinite(targetPrice) ? targetPrice.toFixed(2) : "",
      errors: rowErrors,
    });
  });

  return { rows, errors };
}

export async function enrichRowsWithShopifyVariants(admin, rows) {
  const resultRows = [];
  const errors = [];
  const seenVariantIds = new Map();

  for (const row of rows) {
    if (row.errors.length) {
      resultRows.push(row);
      continue;
    }

    let variant;
    try {
      variant = await findVariantBySku(admin, row.sku, row.productName);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "查询 Shopify 变体失败";
      resultRows.push({
        ...row,
        productId: "",
        variantId: "",
        originalPrice: "",
        currentCompareAtPrice: "",
        errors: [message],
      });
      errors.push(`第 ${row.lineNumber} 行：${message}`);
      continue;
    }

    const rowErrors = [];

    if (variant.error) {
      rowErrors.push(variant.error);
      errors.push(`第 ${row.lineNumber} 行：${variant.error}`);
    } else if (Number(row.targetPrice) >= Number(variant.price)) {
      const message = "目标价格必须小于当前价格，才能生成划线价";
      rowErrors.push(message);
      errors.push(`第 ${row.lineNumber} 行：${message}`);
    } else if (variant.variantId && seenVariantIds.has(variant.variantId)) {
      const message = `与第 ${seenVariantIds.get(variant.variantId)} 行命中了同一个变体`;
      rowErrors.push(message);
      errors.push(`第 ${row.lineNumber} 行：${message}`);
    }

    if (variant.variantId && !rowErrors.length) {
      seenVariantIds.set(variant.variantId, row.lineNumber);
    }

    resultRows.push({
      ...row,
      productName: variant.productTitle || row.productName || "",
      productId: variant.productId || "",
      variantId: variant.variantId || "",
      originalPrice: variant.price || "",
      currentCompareAtPrice: variant.compareAtPrice || "",
      errors: rowErrors,
    });
  }

  return { rows: resultRows, errors };
}

export async function createPriceTask({
  shop,
  createdBy,
  name,
  fileName,
  rows,
}) {
  return prisma.priceChangeTask.create({
    data: {
      shop,
      name,
      createdBy,
      fileName,
      totalCount: rows.length,
      items: {
        create: rows.map((row) => ({
          sku: row.sku,
          productTitle: row.productName || "",
          productId: row.productId,
          variantId: row.variantId,
          originalPrice: row.originalPrice,
          originalCompareAtPrice: row.currentCompareAtPrice || null,
          targetPrice: row.targetPrice,
        })),
      },
    },
  });
}

export async function applyCompareAtPriceTask(admin, shop, taskId) {
  const task = await getTaskForShop(shop, taskId);
  if (!task) return { ok: false, message: "任务不存在" };
  if (
    ![
      TASK_STATUS.pending,
      TASK_STATUS.failed,
      TASK_STATUS.partiallyFailed,
    ].includes(task.status)
  ) {
    return { ok: false, message: "当前状态不能执行修改价格" };
  }

  await prisma.priceChangeTask.update({
    where: { id: task.id },
    data: { status: TASK_STATUS.priceChanging },
  });

  const result = await updateItems(task, async (item) =>
    updateVariantSalePrice(admin, item.productId, item.variantId, item.targetPrice),
  );

  const status = getChangeStatus(result.successCount, result.failedCount);
  await prisma.priceChangeTask.update({
    where: { id: task.id },
    data: {
      status,
      successCount: result.successCount,
      failedCount: result.failedCount,
    },
  });

  await sendPriceTaskFeishuNotice(admin, shop, task.id, "修改价格");

  return { ok: true, taskId: task.id, status, ...result };
}

export async function restorePriceTask(admin, shop, taskId) {
  const task = await getTaskForShop(shop, taskId);
  if (!task) return { ok: false, message: "任务不存在" };
  if (
    ![
      TASK_STATUS.priceChanged,
      TASK_STATUS.restoring,
      TASK_STATUS.partiallyFailed,
      TASK_STATUS.completed,
    ].includes(task.status)
  ) {
    return { ok: false, message: "当前状态不能执行恢复价格" };
  }

  await prisma.priceChangeTask.update({
    where: { id: task.id },
    data: { status: TASK_STATUS.restoring },
  });

  const restorableItems = task.items.filter(
    (item) => item.changeStatus === ITEM_STATUS.success,
  );
  if (restorableItems.length === 0) {
    await prisma.priceChangeTask.update({
      where: { id: task.id },
      data: { status: TASK_STATUS.failed },
    });
    return { ok: false, message: "没有已成功修改的 SKU 可恢复" };
  }

  let successCount = 0;
  let failedCount = 0;

  for (const item of restorableItems) {
    if (item.restoreStatus === ITEM_STATUS.success) {
      successCount += 1;
      continue;
    }

    const result = await safelyUpdateVariantPrice(admin, {
      productId: item.productId,
      variantId: item.variantId,
      price: item.originalPrice,
    });

    if (result.ok) {
      successCount += 1;
      await prisma.priceChangeTaskItem.update({
        where: { id: item.id },
        data: {
          restoreStatus: ITEM_STATUS.success,
          errorMessage: null,
          restoredAt: new Date(),
        },
      });
    } else {
      failedCount += 1;
      await prisma.priceChangeTaskItem.update({
        where: { id: item.id },
        data: {
          restoreStatus: ITEM_STATUS.failed,
          errorMessage: result.message,
        },
      });
    }
  }

  const status =
    failedCount === 0 ? TASK_STATUS.completed : TASK_STATUS.partiallyFailed;
  await prisma.priceChangeTask.update({
    where: { id: task.id },
    data: {
      status,
      successCount,
      failedCount,
    },
  });

  await sendPriceTaskFeishuNotice(admin, shop, task.id, "恢复价格");

  return { ok: true, taskId: task.id, status, successCount, failedCount };
}

async function getTaskForShop(shop, taskId) {
  return prisma.priceChangeTask.findFirst({
    where: { id: taskId, shop },
    include: { items: { orderBy: { id: "asc" } } },
  });
}

async function updateItems(task, updater) {
  let successCount = 0;
  let failedCount = 0;

  for (const item of task.items) {
    if (item.changeStatus === ITEM_STATUS.success) {
      successCount += 1;
      continue;
    }

    const result = await updater(item);
    if (result.ok) {
      successCount += 1;
      await prisma.priceChangeTaskItem.update({
        where: { id: item.id },
        data: {
          changeStatus: ITEM_STATUS.success,
          restoreStatus: ITEM_STATUS.pending,
          errorMessage: null,
          changedAt: new Date(),
        },
      });
    } else {
      failedCount += 1;
      await prisma.priceChangeTaskItem.update({
        where: { id: item.id },
        data: {
          changeStatus: ITEM_STATUS.failed,
          errorMessage: result.message,
        },
      });
    }
  }

  return { successCount, failedCount };
}

function getChangeStatus(successCount, failedCount) {
  if (failedCount === 0) return TASK_STATUS.priceChanged;
  if (successCount > 0) return TASK_STATUS.partiallyFailed;
  return TASK_STATUS.failed;
}

async function findVariantBySku(admin, sku, productName = "") {
  const matches = await listVariantsBySku(admin, sku, productName);
  if (matches.error) return { error: matches.error };

  const selectedMatches = matches.variants;
  if (selectedMatches.length === 0) {
    if (productName.trim()) {
      const availableTitles = matches.availableTitles || [];
      return {
        error: availableTitles.length
          ? `SKU ${sku} 未找到产品名称“${productName}”。可选产品：${availableTitles.join("、")}`
          : `SKU ${sku} 未找到产品名称“${productName}”`,
      };
    }
    return { error: `SKU ${sku} 不存在` };
  }

  if (selectedMatches.length > 1) {
    const availableTitles = uniqueProductTitles(selectedMatches);
    return {
      error: `SKU ${sku} 匹配到多个产品，请填写产品名称以精确命中。可选产品：${availableTitles.join("、")}`,
    };
  }

  const variant = selectedMatches[0];
  return {
    variantId: variant.id,
    productId: variant.product.id,
    productTitle: variant.product?.title || "",
    productHandle: variant.product.handle,
    onlineStoreUrl: variant.product.onlineStoreUrl,
    price: Number(variant.price).toFixed(2),
    compareAtPrice: variant.compareAtPrice
      ? Number(variant.compareAtPrice).toFixed(2)
      : "",
  };
}

async function listVariantsBySku(admin, sku, productName = "") {
  const variants = [];
  const allSkuMatches = [];
  const seenIds = new Set();
  const normalizedProductName = productName.trim().toLowerCase();
  let cursor = null;
  let hasNextPage = true;
  let pages = 0;
  const pageSize = 25;
  const maxPages = 3;

  while (hasNextPage && pages < maxPages) {
    let json;
    try {
      json = await adminGraphqlJson(
        admin,
        `#graphql
          query VariantBySku($query: String!, $cursor: String) {
            productVariants(first: ${pageSize}, after: $cursor, query: $query) {
              pageInfo {
                hasNextPage
                endCursor
              }
              nodes {
                id
                sku
                price
                compareAtPrice
                product {
                  id
                  title
                  handle
                  status
                  onlineStoreUrl
                }
              }
            }
          }`,
        { query: skuSearchQuery(sku), cursor },
      );
    } catch (error) {
      return {
        variants: [],
        availableTitles: [],
        error:
          error instanceof Error
            ? error.message
            : "查询 Shopify SKU 超时，请检查网络后重试",
      };
    }

    if (json.errors?.length) {
      return {
        variants: [],
        availableTitles: [],
        error: json.errors[0]?.message || "查询 SKU 失败",
      };
    }

    const connection = json.data?.productVariants;
    const nodes = connection?.nodes || [];
    nodes.forEach((node) => {
      if (node.sku !== sku || seenIds.has(node.id)) return;
      // 忽略草稿、归档产品，只匹配已上架（ACTIVE）
      if (!isActiveProduct(node.product)) return;
      seenIds.add(node.id);
      allSkuMatches.push(node);

      if (
        !normalizedProductName ||
        String(node.product?.title || "")
          .trim()
          .toLowerCase() === normalizedProductName
      ) {
        variants.push(node);
      }
    });

    hasNextPage = Boolean(connection?.pageInfo?.hasNextPage);
    cursor = connection?.pageInfo?.endCursor || null;
    pages += 1;
    if (nodes.length === 0) hasNextPage = false;

    // 已确认多个匹配时无需继续翻页
    if (variants.length > 1) break;
  }

  if (hasNextPage && variants.length <= 1) {
    return {
      variants: [],
      availableTitles: uniqueProductTitles(allSkuMatches),
      error: normalizedProductName
        ? `SKU ${sku} 匹配到的变体过多，无法确认产品名称“${productName}”`
        : `SKU ${sku} 匹配到的变体过多，请填写产品名称后重试`,
    };
  }

  return {
    variants,
    availableTitles: uniqueProductTitles(allSkuMatches),
    error: "",
  };
}

const SHOPIFY_GRAPHQL_TIMEOUT_MS = 15000;

async function adminGraphqlJson(admin, query, variables) {
  let timeoutId;
  try {
    const response = await Promise.race([
      admin.graphql(query, { variables }),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error("查询 Shopify 超时，请检查网络后重试"));
        }, SHOPIFY_GRAPHQL_TIMEOUT_MS);
      }),
    ]);
    return response.json();
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function uniqueProductTitles(variants) {
  return [
    ...new Set(
      variants
        .map((node) => String(node.product?.title || "").trim())
        .filter(Boolean),
    ),
  ];
}

function isActiveProduct(product) {
  return String(product?.status || "").toUpperCase() === "ACTIVE";
}

function skuSearchQuery(sku) {
  const escaped = String(sku).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `sku:"${escaped}"`;
}

async function updateVariantSalePrice(admin, productId, variantId, targetPrice) {
  // 只改售价，不改动 Shopify 原价/划线价（compareAtPrice）
  return safelyUpdateVariantPrice(admin, {
    productId,
    variantId,
    price: targetPrice,
  });
}

async function updateVariantPrice(admin, { productId, variantId, price }) {
  const variantInput = {
    id: variantId,
    price: Number(price).toFixed(2),
  };

  const response = await admin.graphql(
    `#graphql
      mutation ProductVariantsBulkUpdate(
        $productId: ID!
        $variants: [ProductVariantsBulkInput!]!
      ) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          productVariants {
            id
          }
          userErrors {
            field
            message
          }
        }
      }`,
    {
      variables: {
        productId,
        variants: [variantInput],
      },
    },
  );
  const json = await response.json();
  const result = json.data?.productVariantsBulkUpdate;
  const message = json.errors?.[0]?.message || result?.userErrors?.[0]?.message;

  return message ? { ok: false, message } : { ok: true };
}

async function safelyUpdateVariantPrice(admin, input) {
  try {
    return await updateVariantPrice(admin, input);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function sendPriceTaskFeishuNotice(admin, shop, taskId, modifyType) {
  try {
    const task = await getTaskForShop(shop, taskId);
    if (!task) return;

    const changedItems =
      modifyType === "恢复价格"
        ? task.items.filter(
            (item) => item.restoreStatus === ITEM_STATUS.success,
          )
        : task.items.filter(
            (item) => item.changeStatus === ITEM_STATUS.success,
          );

    if (changedItems.length === 0) return;

    const shopUrl = await getShopPrimaryUrl(admin);
    const tableRows = [
      "| 产品名 | 变体名 | SKU | 原价 | 售价 | 在线链接 |",
      "| --- | --- | --- | --- | --- | --- |",
    ];

    for (const item of changedItems) {
      const variantInfo = await getVariantOnlineInfo(
        admin,
        item.variantId,
        shopUrl,
      );
      // 原价 = Shopify 划线价（compareAtPrice），没有则显示 "-"；售价 = 当前售价
      const originalPrice = variantInfo.compareAtPrice || "-";
      const salePrice = variantInfo.price || "-";
      const onlineLink = variantInfo.onlineUrl
        ? `[查看商品](${variantInfo.onlineUrl})`
        : "-";
      tableRows.push(
        `| ${escapeMarkdownTableCell(variantInfo.productTitle)} | ${escapeMarkdownTableCell(
          variantInfo.variantTitle,
        )} | ${escapeMarkdownTableCell(item.sku)} | ${originalPrice} | ${salePrice} | ${onlineLink} |`,
      );
    }

    const markdown = [
      `**店铺：** ${shop}`,
      `**任务：** ${task.name}`,
      `**修改类型：** ${modifyType}`,
      `**成功：** ${task.successCount} / **失败：** ${task.failedCount}`,
      "",
      tableRows.join("\n"),
    ].join("\n");

    await fetch(FEISHU_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        msg_type: "interactive",
        card: {
          config: {
            wide_screen_mode: true,
          },
          elements: [
            {
              tag: "markdown",
              content: markdown,
            },
          ],
          header: {
            title: {
              tag: "plain_text",
              content: "划线价修改提醒",
            },
          },
        },
      }),
    });
  } catch (error) {
    console.error("[price-task-feishu-notice]", error);
  }
}

function escapeMarkdownTableCell(value) {
  return String(value || "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");
}

async function getShopPrimaryUrl(admin) {
  const response = await admin.graphql(
    `#graphql
      query ShopPrimaryUrl {
        shop {
          primaryDomain {
            url
          }
        }
      }`,
  );
  const json = await response.json();
  return json.data?.shop?.primaryDomain?.url || "";
}

async function getVariantOnlineInfo(admin, variantId, shopUrl) {
  const response = await admin.graphql(
    `#graphql
      query VariantOnlineUrl($id: ID!) {
        node(id: $id) {
          ... on ProductVariant {
            title
            price
            compareAtPrice
            product {
              title
              handle
              onlineStoreUrl
            }
          }
        }
      }`,
    { variables: { id: variantId } },
  );
  const json = await response.json();
  const variant = json.data?.node;
  const product = json.data?.node?.product;
  const onlineUrl =
    product?.onlineStoreUrl ||
    (shopUrl && product?.handle ? `${shopUrl}/products/${product.handle}` : "");

  return {
    productTitle: product?.title || "-",
    variantTitle: variant?.title || "-",
    price: variant?.price ? Number(variant.price).toFixed(2) : "",
    compareAtPrice: variant?.compareAtPrice
      ? Number(variant.compareAtPrice).toFixed(2)
      : "",
    onlineUrl,
  };
}
