import prisma from "../db.server";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** @param {unknown} raw */
export function validateEmail(raw) {
  const email = String(raw ?? "").trim();
  if (!email) {
    return { ok: false, error: "请输入邮箱" };
  }
  if (!EMAIL_PATTERN.test(email)) {
    return { ok: false, error: "邮箱格式不正确" };
  }
  return { ok: true, email };
}

/** @param {string} shop @param {string} email */
export async function saveEmailForShop(shop, email) {
  return prisma.savedEmail.create({
    data: { shop, email },
  });
}
