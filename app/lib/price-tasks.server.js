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
  const seenSkus = new Set();
  const rows = [];
  const errors = [];

  rawRows.forEach((row, index) => {
    const lineNumber = index + 2;
    const sku = String(row.SKU ?? row.sku ?? "").trim();
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

    const skuKey = sku.toLowerCase();
    if (sku && seenSkus.has(skuKey)) {
      rowErrors.push("Excel 中存在重复 SKU");
    }
    if (sku) seenSkus.add(skuKey);

    if (!sku && !priceText) return;

    if (rowErrors.length) {
      errors.push(`第 ${lineNumber} 行：${rowErrors.join("；")}`);
    }

    rows.push({
      lineNumber,
      sku,
      targetPrice: Number.isFinite(targetPrice) ? targetPrice.toFixed(2) : "",
      errors: rowErrors,
    });
  });

  return { rows, errors };
}

export async function enrichRowsWithShopifyVariants(admin, rows) {
  const resultRows = [];
  const errors = [];

  for (const row of rows) {
    if (row.errors.length) {
      resultRows.push(row);
      continue;
    }

    const variant = await findVariantBySku(admin, row.sku);
    const rowErrors = [];

    if (variant.error) {
      rowErrors.push(variant.error);
      errors.push(`第 ${row.lineNumber} 行：${variant.error}`);
    } else if (Number(row.targetPrice) >= Number(variant.price)) {
      const message = "目标价格必须小于当前价格，才能生成划线价";
      rowErrors.push(message);
      errors.push(`第 ${row.lineNumber} 行：${message}`);
    }

    resultRows.push({
      ...row,
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
    updateVariantSalePrice(
      admin,
      item.productId,
      item.variantId,
      item.targetPrice,
      item.originalPrice,
      item.originalCompareAtPrice,
    ),
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
      compareAtPrice: item.originalCompareAtPrice ?? null,
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

async function findVariantBySku(admin, sku) {
  const response = await admin.graphql(
    `#graphql
      query VariantBySku($query: String!) {
        productVariants(first: 3, query: $query) {
          nodes {
            id
            sku
            price
            compareAtPrice
            product {
              id
              handle
              onlineStoreUrl
            }
          }
        }
      }`,
    { variables: { query: `sku:${sku}` } },
  );
  const json = await response.json();
  const nodes = json.data?.productVariants?.nodes || [];
  const exactMatches = nodes.filter((node) => node.sku === sku);

  if (exactMatches.length === 0) return { error: `SKU ${sku} 不存在` };
  if (exactMatches.length > 1) return { error: `SKU ${sku} 匹配到多个变体` };

  const variant = exactMatches[0];
  return {
    variantId: variant.id,
    productId: variant.product.id,
    productHandle: variant.product.handle,
    onlineStoreUrl: variant.product.onlineStoreUrl,
    price: Number(variant.price).toFixed(2),
    compareAtPrice: variant.compareAtPrice
      ? Number(variant.compareAtPrice).toFixed(2)
      : "",
  };
}

async function updateVariantSalePrice(
  admin,
  productId,
  variantId,
  targetPrice,
  originalPrice,
  originalCompareAtPrice,
) {
  const compareAtPrice = originalCompareAtPrice || originalPrice;

  return safelyUpdateVariantPrice(admin, {
    productId,
    variantId,
    price: targetPrice,
    compareAtPrice,
  });
}

async function updateVariantPrice(
  admin,
  { productId, variantId, price, compareAtPrice },
) {
  const variantInput = {
    id: variantId,
    price: Number(price).toFixed(2),
    compareAtPrice:
      compareAtPrice === null ? null : Number(compareAtPrice).toFixed(2),
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
      const compareAtPrice =
        item.originalCompareAtPrice?.toString() ||
        (modifyType === "恢复价格" ? "-" : item.originalPrice.toString());
      const salePrice =
        modifyType === "恢复价格"
          ? item.originalPrice.toString()
          : item.targetPrice.toString();
      const onlineLink = variantInfo.onlineUrl
        ? `[查看商品](${variantInfo.onlineUrl})`
        : "-";
      tableRows.push(
        `| ${escapeMarkdownTableCell(variantInfo.productTitle)} | ${escapeMarkdownTableCell(
          variantInfo.variantTitle,
        )} | ${escapeMarkdownTableCell(item.sku)} | ${compareAtPrice} | ${salePrice} | ${onlineLink} |`,
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
    onlineUrl,
  };
}
