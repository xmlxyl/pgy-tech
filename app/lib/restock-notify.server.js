import prisma from "../db.server";
import { normalizeOptionalText } from "./saved-email.server";

function notifyModel() {
  return prisma.restockNotify ?? null;
}

/**
 * @param {string} shop
 * @param {string} email
 * @param {string} variantId
 */
async function findRestockNotify(shop, email, variantId) {
  const model = notifyModel();
  if (model) {
    return model.findUnique({
      where: {
        shop_email_variantId: { shop, email, variantId },
      },
    });
  }

  const rows = await prisma.$queryRaw`
    SELECT "id", "shop", "email", "productId", "productTitle", "variantId", "variantTitle", "createdAt"
    FROM "RestockNotify"
    WHERE "shop" = ${shop} AND "email" = ${email} AND "variantId" = ${variantId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/**
 * @param {string} shop
 * @param {string} email
 * @param {string} productId
 * @param {string} productTitle
 * @param {string} variantId
 * @param {string} variantTitle
 */
async function insertRestockNotify(
  shop,
  email,
  productId,
  productTitle,
  variantId,
  variantTitle,
) {
  const model = notifyModel();
  if (model) {
    return model.create({
      data: {
        shop,
        email,
        productId,
        productTitle,
        variantId,
        variantTitle,
      },
    });
  }

  const rows = await prisma.$queryRaw`
    INSERT INTO "RestockNotify" ("shop", "email", "productId", "productTitle", "variantId", "variantTitle")
    VALUES (${shop}, ${email}, ${productId}, ${productTitle}, ${variantId}, ${variantTitle})
    ON CONFLICT ("shop", "email", "variantId") DO NOTHING
    RETURNING "id", "shop", "email", "productId", "productTitle", "variantId", "variantTitle", "createdAt"
  `;
  return rows[0] ?? null;
}

/**
 * @param {string} shop
 * @param {string} email
 * @param {{ productId?: unknown, productTitle?: unknown, variantId?: unknown, variantTitle?: unknown }} raw
 */
export async function saveRestockNotify(shop, email, raw) {
  const productId = normalizeOptionalText(raw.productId);
  const productTitle = normalizeOptionalText(raw.productTitle);
  const variantId = normalizeOptionalText(raw.variantId) || productId;
  const variantTitle = String(raw.variantTitle ?? "").trim();

  if (!productId || !productTitle || !variantId) {
    return { ok: false, error: "缺少产品信息" };
  }

  const existing = await findRestockNotify(shop, email, variantId);
  if (existing) {
    return { ok: true, alreadySubscribed: true, record: existing };
  }

  try {
    const record = await insertRestockNotify(
      shop,
      email,
      productId,
      productTitle,
      variantId,
      variantTitle,
    );
    if (!record) {
      const raced = await findRestockNotify(shop, email, variantId);
      return { ok: true, alreadySubscribed: true, record: raced };
    }
    return { ok: true, alreadySubscribed: false, record };
  } catch (error) {
    if (error && error.code === "P2002") {
      const raced = await findRestockNotify(shop, email, variantId);
      return { ok: true, alreadySubscribed: true, record: raced };
    }
    throw error;
  }
}

/** @param {string} shop */
export async function listRestockNotifies(shop) {
  const model = notifyModel();
  if (model) {
    return model.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
    });
  }

  return prisma.$queryRaw`
    SELECT "id", "shop", "email", "productId", "productTitle", "variantId", "variantTitle", "createdAt"
    FROM "RestockNotify"
    WHERE "shop" = ${shop}
    ORDER BY "createdAt" DESC
  `;
}
