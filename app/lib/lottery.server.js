import prisma from "../db.server";
import { validateEmail } from "./saved-email.server";
import { createCouponDiscount } from "./shopify-discount.server";
import { subscribeCustomerEmail } from "./shopify-customer.server";
import { sendLotteryEmail } from "./lottery-email.server";

const DEFAULT_PRIZES = [
  { slot: 1, title: "6% OFF Coupon", weight: 20, discountPercent: 6 },
  { slot: 2, title: "5% OFF Coupon", weight: 25, discountPercent: 5 },
  { slot: 3, title: "10% OFF Coupon", weight: 15, discountPercent: 10 },
  { slot: 4, title: "8% OFF Coupon", weight: 15, discountPercent: 8 },
  { slot: 5, title: "12% OFF Coupon", weight: 10, discountPercent: 12 },
  { slot: 6, title: "15% OFF Coupon", weight: 15, discountPercent: 15 },
];

/** @param {string} shop */
export async function ensureDefaultLotteryConfig(shop) {
  const existing = await prisma.lotteryPrize.count({ where: { shop } });
  if (existing > 0) return;

  await prisma.lotteryPrize.createMany({
    data: DEFAULT_PRIZES.map((prize) => ({
      shop,
      slot: prize.slot,
      title: prize.title,
      weight: prize.weight,
      discountPercent: prize.discountPercent,
      enabled: true,
    })),
  });

  await prisma.lotterySettings.upsert({
    where: { shop },
    create: { shop },
    update: {},
  });
}

/** @param {string} shop */
export async function getLotteryPrizesForShop(shop) {
  await ensureDefaultLotteryConfig(shop);
  return prisma.lotteryPrize.findMany({
    where: { shop },
    orderBy: { slot: "asc" },
  });
}

/** @param {string} shop */
export async function getLotterySettingsForShop(shop) {
  await ensureDefaultLotteryConfig(shop);
  return prisma.lotterySettings.findUnique({ where: { shop } });
}

/** @param {Array<{ enabled: boolean, weight: number }>} prizes */
export function pickWeightedPrize(prizes) {
  const pool = prizes.filter((p) => p.enabled && p.weight > 0);
  if (pool.length === 0) {
    throw new Error("未配置可用奖品");
  }

  const total = pool.reduce((sum, p) => sum + p.weight, 0);
  let roll = Math.random() * total;
  for (const prize of pool) {
    roll -= prize.weight;
    if (roll <= 0) return prize;
  }
  return pool[pool.length - 1];
}

/** @param {string} shop @param {string} title @param {number} percent */
function buildCouponCode(shop, title, percent) {
  const slug = title
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 6)
    .toUpperCase();
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  const shopPart = shop.split(".")[0].slice(0, 4).toUpperCase();
  return `PGY-${shopPart}-${percent}-${slug || "WIN"}-${suffix}`;
}

/**
 * @param {object} params
 * @param {string} params.shop
 * @param {string} params.email
 * @param {import("@shopify/shopify-app-react-router/server").AdminApiContext["graphql"]} [params.adminGraphql]
 */
export async function runLotteryDraw({ shop, email, adminGraphql }) {
  const validation = validateEmail(email);
  if (!validation.ok) {
    return { ok: false, status: 400, error: validation.error };
  }

  const normalizedEmail = validation.email;

  if (!adminGraphql) {
    return {
      ok: false,
      status: 401,
      error: "请在店铺前台页面测试（非主题编辑器预览），并确认应用已安装",
    };
  }

  const existing = await prisma.lotteryEntry.findUnique({
    where: { shop_email: { shop, email: normalizedEmail } },
  });
  if (existing) {
    return {
      ok: false,
      status: 409,
      error: "该邮箱已参与过抽奖，每人仅限一次",
      entry: existing,
    };
  }

  const prizes = await getLotteryPrizesForShop(shop);
  const prize = pickWeightedPrize(prizes);
  const couponCode = buildCouponCode(shop, prize.title, prize.discountPercent);

  try {
    await createCouponDiscount(adminGraphql, {
      code: couponCode,
      title: `Lottery: ${prize.title}`,
      percentage: prize.discountPercent / 100,
    });
  } catch (error) {
    console.error("[lottery] discount create failed", { shop, error });
    return {
      ok: false,
      status: 500,
      error: "优惠券创建失败，请稍后再试",
    };
  }

  try {
    await subscribeCustomerEmail(adminGraphql, normalizedEmail);
  } catch (error) {
    console.warn("[lottery] customer subscribe failed", { shop, error });
  }

  const entry = await prisma.lotteryEntry.create({
    data: {
      shop,
      email: normalizedEmail,
      prizeSlot: prize.slot,
      prizeTitle: prize.title,
      couponCode,
    },
  });

  await prisma.savedEmail.create({
    data: { shop, email: normalizedEmail },
  }).catch(() => {});

  const settings = await getLotterySettingsForShop(shop);
  const emailResult = await sendLotteryEmail({
    to: normalizedEmail,
    subject: settings?.emailSubject ?? "Your reward coupon is here!",
    bodyHtml: settings?.emailBodyHtml ?? "",
    from: settings?.emailFrom ?? undefined,
    prizeTitle: prize.title,
    couponCode,
  });

  return {
    ok: true,
    prize: {
      slot: prize.slot,
      title: prize.title,
      imageUrl: prize.imageUrl,
      couponCode,
    },
    emailSent: emailResult.sent,
    entry,
  };
}

/** @param {string} shop @param {Array<{ slot: number, title: string, imageUrl?: string | null, weight: number, discountPercent: number, enabled: boolean }>} prizes */
export async function saveLotteryPrizes(shop, prizes) {
  await ensureDefaultLotteryConfig(shop);

  for (const prize of prizes) {
    await prisma.lotteryPrize.upsert({
      where: { shop_slot: { shop, slot: prize.slot } },
      create: {
        shop,
        slot: prize.slot,
        title: prize.title,
        imageUrl: prize.imageUrl || null,
        weight: Math.max(0, Math.floor(prize.weight)),
        discountPercent: Math.max(0, Math.min(100, Number(prize.discountPercent))),
        enabled: Boolean(prize.enabled),
      },
      update: {
        title: prize.title,
        imageUrl: prize.imageUrl || null,
        weight: Math.max(0, Math.floor(prize.weight)),
        discountPercent: Math.max(0, Math.min(100, Number(prize.discountPercent))),
        enabled: Boolean(prize.enabled),
      },
    });
  }
}

/** @param {string} shop @param {{ emailSubject?: string, emailBodyHtml?: string, emailFrom?: string | null }} data */
export async function saveLotterySettings(shop, data) {
  await ensureDefaultLotteryConfig(shop);
  return prisma.lotterySettings.upsert({
    where: { shop },
    create: {
      shop,
      emailSubject: data.emailSubject ?? "Your reward coupon is here!",
      emailBodyHtml:
        data.emailBodyHtml ??
        "<p>Thanks for subscribing! Use code <strong>{{coupon_code}}</strong> for {{prize_title}}.</p>",
      emailFrom: data.emailFrom || null,
    },
    update: {
      ...(data.emailSubject !== undefined ? { emailSubject: data.emailSubject } : {}),
      ...(data.emailBodyHtml !== undefined ? { emailBodyHtml: data.emailBodyHtml } : {}),
      ...(data.emailFrom !== undefined ? { emailFrom: data.emailFrom || null } : {}),
    },
  });
}
