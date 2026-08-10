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

const CHANGE_EXECUTION_GRACE_MS = 2 * 60 * 1000;

export const BEIJING_TIME_ZONE = "Asia/Shanghai";

export function parseBeijingDateTime(value) {
  if (!value) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  const withSeconds =
    normalized.length === 16 ? `${normalized}:00` : normalized;
  const isoLike = withSeconds.replace(" ", "T");
  return new Date(`${isoLike}+08:00`);
}

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
    }

    resultRows.push({
      ...row,
      productId: variant.productId || "",
      variantId: variant.variantId || "",
      originalPrice: variant.price || "",
      errors: rowErrors,
    });
  }

  return { rows: resultRows, errors };
}

export async function createPriceTask({
  shop,
  createdBy,
  name,
  scheduledChangeAt,
  scheduledRestoreAt,
  fileName,
  rows,
}) {
  return prisma.priceChangeTask.create({
    data: {
      shop,
      name,
      createdBy,
      scheduledChangeAt,
      scheduledRestoreAt,
      fileName,
      totalCount: rows.length,
      items: {
        create: rows.map((row) => ({
          sku: row.sku,
          productId: row.productId,
          variantId: row.variantId,
          originalPrice: row.originalPrice,
          targetPrice: row.targetPrice,
        })),
      },
    },
  });
}

export async function runDuePriceTasks(admin, shop) {
  const now = new Date();
  const changeWindowStart = new Date(
    now.getTime() - CHANGE_EXECUTION_GRACE_MS,
  );

  const expiredChangeTasks = await prisma.priceChangeTask.findMany({
    where: {
      shop,
      status: { in: [TASK_STATUS.pending, TASK_STATUS.priceChanging] },
      scheduledChangeAt: { lt: changeWindowStart },
    },
    include: { items: true },
    orderBy: { scheduledChangeAt: "asc" },
    take: 20,
  });

  const changeTasks = await prisma.priceChangeTask.findMany({
    where: {
      shop,
      status: { in: [TASK_STATUS.pending, TASK_STATUS.priceChanging] },
      scheduledChangeAt: { gte: changeWindowStart, lte: now },
    },
    include: { items: true },
    orderBy: { scheduledChangeAt: "asc" },
    take: 10,
  });

  const restoreTasks = await prisma.priceChangeTask.findMany({
    where: {
      shop,
      status: {
        in: [
          TASK_STATUS.priceChanged,
          TASK_STATUS.partiallyFailed,
          TASK_STATUS.restoring,
        ],
      },
      scheduledRestoreAt: { lte: now },
    },
    include: { items: true },
    orderBy: { scheduledRestoreAt: "asc" },
    take: 10,
  });

  const changed = [];
  const restored = [];
  const expired = [];

  for (const task of expiredChangeTasks) {
    expired.push(await expireChangeTask(task));
  }

  for (const task of changeTasks) {
    changed.push(await executeChangeTask(admin, task));
  }

  for (const task of restoreTasks) {
    restored.push(await executeRestoreTask(admin, task));
  }

  return { changed, restored, expired };
}

export async function runDuePriceTasksForAllShops(getAdminForShop) {
  const shops = await prisma.session.findMany({
    distinct: ["shop"],
    select: { shop: true },
    where: {
      shop: {
        not: "",
      },
      accessToken: {
        not: "",
      },
    },
  });

  const results = [];

  for (const { shop } of shops) {
    try {
      const admin = await getAdminForShop(shop);
      const result = await runDuePriceTasks(admin, shop);
      results.push({ shop, ok: true, ...result });
    } catch (error) {
      results.push({
        shop,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

async function executeChangeTask(admin, task) {
  await prisma.priceChangeTask.update({
    where: { id: task.id },
    data: { status: TASK_STATUS.priceChanging },
  });

  let successCount = 0;
  let failedCount = 0;

  for (const item of task.items) {
    if (item.changeStatus === ITEM_STATUS.success) {
      successCount += 1;
      continue;
    }

    const result = await safelyUpdateVariantPrice(
      admin,
      item.productId,
      item.variantId,
      item.targetPrice,
    );
    if (result.ok) {
      successCount += 1;
      await prisma.priceChangeTaskItem.update({
        where: { id: item.id },
        data: {
          changeStatus: ITEM_STATUS.success,
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

  const status =
    failedCount === 0
      ? TASK_STATUS.priceChanged
      : successCount > 0
        ? TASK_STATUS.partiallyFailed
        : TASK_STATUS.failed;

  await prisma.priceChangeTask.update({
    where: { id: task.id },
    data: { status, successCount, failedCount },
  });

  return { taskId: task.id, status, successCount, failedCount };
}

async function expireChangeTask(task) {
  const message = "改价时间已过期，系统未执行改价";

  await prisma.priceChangeTaskItem.updateMany({
    where: {
      taskId: task.id,
      changeStatus: { not: ITEM_STATUS.success },
    },
    data: {
      changeStatus: ITEM_STATUS.skipped,
      restoreStatus: ITEM_STATUS.skipped,
      errorMessage: message,
    },
  });

  await prisma.priceChangeTask.update({
    where: { id: task.id },
    data: {
      status: TASK_STATUS.failed,
      successCount: task.items.filter(
        (item) => item.changeStatus === ITEM_STATUS.success,
      ).length,
      failedCount: task.items.filter(
        (item) => item.changeStatus !== ITEM_STATUS.success,
      ).length,
    },
  });

  return {
    taskId: task.id,
    status: TASK_STATUS.failed,
    message,
  };
}

async function executeRestoreTask(admin, task) {
  await prisma.priceChangeTask.update({
    where: { id: task.id },
    data: { status: TASK_STATUS.restoring },
  });

  let successCount = 0;
  let failedCount = 0;

  for (const item of task.items) {
    if (item.changeStatus !== ITEM_STATUS.success) continue;
    if (item.restoreStatus === ITEM_STATUS.success) {
      successCount += 1;
      continue;
    }

    const result = await safelyUpdateVariantPrice(
      admin,
      item.productId,
      item.variantId,
      item.originalPrice,
    );
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

  const status = failedCount === 0 ? TASK_STATUS.completed : TASK_STATUS.partiallyFailed;

  await prisma.priceChangeTask.update({
    where: { id: task.id },
    data: { status, successCount, failedCount },
  });

  return { taskId: task.id, status, successCount, failedCount };
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
            product {
              id
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
    price: Number(variant.price).toFixed(2),
  };
}

async function updateVariantPrice(admin, productId, variantId, price) {
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
        variants: [
          {
            id: variantId,
            price: Number(price).toFixed(2),
          },
        ],
      },
    },
  );
  const json = await response.json();
  const result = json.data?.productVariantsBulkUpdate;
  const message = json.errors?.[0]?.message || result?.userErrors?.[0]?.message;

  return message ? { ok: false, message } : { ok: true };
}

async function safelyUpdateVariantPrice(admin, productId, variantId, price) {
  try {
    return await updateVariantPrice(admin, productId, variantId, price);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
