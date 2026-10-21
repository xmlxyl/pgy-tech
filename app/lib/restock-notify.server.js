import prisma from "../db.server";
import { normalizeOptionalText } from "./saved-email.server";

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

  const where = {
    shop_email_variantId: {
      shop,
      email,
      variantId,
    },
  };
  const existing = await prisma.restockNotify.findUnique({ where });
  if (existing) {
    return { ok: true, alreadySubscribed: true, record: existing };
  }

  try {
    const record = await prisma.restockNotify.create({
      data: {
        shop,
        email,
        productId,
        productTitle,
        variantId,
        variantTitle,
      },
    });
    return { ok: true, alreadySubscribed: false, record };
  } catch (error) {
    if (error && error.code === "P2002") {
      const raced = await prisma.restockNotify.findUnique({ where });
      return { ok: true, alreadySubscribed: true, record: raced };
    }
    throw error;
  }
}
