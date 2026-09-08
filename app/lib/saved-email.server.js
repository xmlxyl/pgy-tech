import prisma from "../db.server";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** @param {unknown} raw */
export function validateEmail(raw) {
  const email = String(raw ?? "").trim().toLowerCase();
  if (!email) {
    return { ok: false, error: "请输入邮箱" };
  }
  if (!EMAIL_PATTERN.test(email)) {
    return { ok: false, error: "邮箱格式不正确" };
  }
  return { ok: true, email };
}

/** @param {unknown} raw */
export function normalizeOptionalText(raw) {
  const value = String(raw ?? "").trim();
  return value || null;
}

/**
 * @param {string} shop
 * @param {string} email
 * @param {string | null | undefined} type
 */
export async function findSavedEmail(shop, email, type) {
  return prisma.savedEmail.findFirst({
    where: {
      shop,
      email,
      type: normalizeOptionalText(type),
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * @param {string} shop
 * @param {string} email
 * @param {string | null | undefined} username
 * @param {string | null | undefined} type
 * @returns {Promise<{ alreadySubscribed: boolean, record: object }>}
 */
export async function saveEmailForShop(shop, email, username, type) {
  const normalizedType = normalizeOptionalText(type);
  const existing = await findSavedEmail(shop, email, normalizedType);
  if (existing) {
    return { alreadySubscribed: true, record: existing };
  }

  const record = await prisma.savedEmail.create({
    data: {
      shop,
      email,
      username: normalizeOptionalText(username),
      type: normalizedType,
    },
  });
  return { alreadySubscribed: false, record };
}
