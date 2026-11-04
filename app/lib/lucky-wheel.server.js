import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { saveEmailForShop, validateEmail } from "./saved-email.server";

const PDT_OFFSET_MINUTES = -7 * 60;
const PRIZE_COUNT = 3;
const SECTOR_COUNT = 6;

/** Default window: Nov 18 00:00:00 through Dec 31 23:59:59 (PDT). */
export function defaultLuckyWheelValidity() {
  return {
    codeStartsAt: "2026-11-18T00:00:00",
    codeEndsAt: "2026-12-31T23:59:59",
  };
}

export function defaultLuckyWheelPrizes() {
  return [
    { percentOff: 2, probability: 60, label: "Extra 2% OFF", couponCode: "BFEXTRA2" },
    { percentOff: 3, probability: 30, label: "Extra 3% OFF", couponCode: "BFEXTRA3" },
    { percentOff: 5, probability: 10, label: "Extra 5% OFF", couponCode: "BFEXTRA5" },
  ];
}

export function defaultLuckyWheelSettings() {
  const validity = defaultLuckyWheelValidity();
  return {
    enabled: true,
    codePrefix: "LW-",
    codeStartsAt: validity.codeStartsAt,
    codeEndsAt: validity.codeEndsAt,
    prizes: defaultLuckyWheelPrizes(),
    setupError: null,
  };
}

/** @param {string} shop */
export async function getLuckyWheelSetting(shop) {
  const defaults = defaultLuckyWheelSettings();
  if (!hasLuckyWheelModels()) {
    return {
      ...defaults,
      setupError: "数据库尚未更新幸运转盘，请先执行 prisma migrate deploy。",
    };
  }

  try {
    const setting = await prisma.luckyWheelSetting.findUnique({ where: { shop } });
    if (!setting) return defaults;
    return {
      enabled: Boolean(setting.enabled),
      codePrefix: normalizePrefix(setting.codePrefix),
      codeStartsAt: dateInputValue(setting.codeStartsAt) || defaults.codeStartsAt,
      codeEndsAt: dateInputValue(setting.codeEndsAt) || defaults.codeEndsAt,
      prizes: normalizePrizes(setting.prizes),
      setupError: null,
    };
  } catch (error) {
    if (isMissingLuckyWheelTableError(error)) {
      return {
        ...defaults,
        setupError: "数据库尚未更新幸运转盘，请先执行 prisma migrate deploy。",
      };
    }
    throw error;
  }
}

/** @param {string} shop @param {number} [limit] */
export async function listRecentLuckyWheelClaims(shop, limit = 20) {
  if (!hasLuckyWheelModels()) return [];
  try {
    const rows = await prisma.luckyWheelClaim.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows.map(serializeClaimAdmin);
  } catch (error) {
    if (isMissingLuckyWheelTableError(error)) return [];
    throw error;
  }
}

/**
 * @param {string} shop
 * @param {FormData} formData
 */
export async function saveLuckyWheelSetting(shop, formData) {
  if (!hasLuckyWheelModels()) {
    return {
      ok: false,
      message: "数据库尚未更新幸运转盘，请先执行 prisma migrate deploy。",
    };
  }

  const enabled = formData.get("enabled") === "on" || formData.get("enabled") === "true";
  const codePrefix = normalizePrefix(formData.get("codePrefix"));
  const codeStartsAt = parsePdtDateInput(formData.get("codeStartsAt"));
  const codeEndsAt = parsePdtDateInput(formData.get("codeEndsAt"));
  const prizes = [];

  for (let index = 0; index < PRIZE_COUNT; index += 1) {
    prizes.push({
      percentOff: Number(formData.get(`percentOff${index}`)),
      probability: Number(formData.get(`probability${index}`)),
      label: String(formData.get(`label${index}`) || "").trim(),
      couponCode: String(formData.get(`couponCode${index}`) || "").trim(),
    });
  }

  const normalized = normalizePrizes(prizes);
  const totalProbability = normalized.reduce((sum, prize) => sum + prize.probability, 0);

  if (Math.abs(totalProbability - 100) > 0.001) {
    return {
      ok: false,
      message: `奖池概率之和必须为 100%，当前为 ${roundProbability(totalProbability)}%。`,
    };
  }

  if (normalized.some((prize) => prize.percentOff <= 0 || prize.percentOff > 100)) {
    return { ok: false, message: "折扣百分比需要大于 0，且不超过 100。" };
  }

  if (normalized.some((prize) => !prize.couponCode)) {
    return { ok: false, message: "每个奖励都要填写优惠码。" };
  }

  if (Number.isNaN(codeStartsAt.getTime()) || Number.isNaN(codeEndsAt.getTime())) {
    return { ok: false, message: "优惠码有效期时间格式不正确。" };
  }

  if (codeEndsAt.getTime() <= codeStartsAt.getTime()) {
    return { ok: false, message: "优惠码结束时间必须晚于开始时间。" };
  }

  try {
    await prisma.luckyWheelSetting.upsert({
      where: { shop },
      create: {
        shop,
        enabled,
        codePrefix,
        codeStartsAt,
        codeEndsAt,
        prizes: normalized,
      },
      update: {
        enabled,
        codePrefix,
        codeStartsAt,
        codeEndsAt,
        prizes: normalized,
      },
    });
    return { ok: true, message: "幸运转盘配置已保存。" };
  } catch (error) {
    if (isMissingLuckyWheelTableError(error)) {
      return {
        ok: false,
        message: "数据库尚未更新幸运转盘，请先执行 prisma migrate deploy。",
      };
    }
    console.error("[lucky-wheel-save]", error);
    return { ok: false, message: "保存失败，请稍后再试。" };
  }
}

/** @param {Request} request */
export async function handleLuckyWheelProxyRequest(request) {
  const method = request.method.toUpperCase();
  const action = new URL(request.url).searchParams.get("action") || "config";

  if (method === "GET") {
    if (action === "status") return getClaimStatus(request);
    return getPublicConfig(request);
  }

  if (method === "POST") return spinWheel(request);

  return Response.json({ ok: false, error: "Method not allowed" }, { status: 405 });
}

/** @param {Request} request */
async function getPublicConfig(request) {
  const auth = await resolveProxyShop(request);
  if (!auth.ok) {
    return Response.json({ ok: false, error: auth.message }, { status: auth.status || 401 });
  }

  const setting = await getLuckyWheelSetting(auth.shop);
  return Response.json({
    ok: true,
    enabled: setting.enabled && !setting.setupError,
    prizes: setting.prizes.map((prize) => ({
      percentOff: prize.percentOff,
      label: prize.label,
    })),
  });
}

/** @param {Request} request */
async function getClaimStatus(request) {
  const auth = await resolveProxyShop(request);
  if (!auth.ok) {
    return Response.json({ ok: false, error: auth.message }, { status: auth.status || 401 });
  }

  const validation = validateEmail(new URL(request.url).searchParams.get("email"));
  if (!validation.ok) {
    return Response.json({ ok: false, error: "Enter a valid email address." }, { status: 400 });
  }

  const claim = await findClaimByEmail(auth.shop, validation.email);
  if (!claim) {
    return Response.json({ ok: true, claimed: false, claim: null });
  }

  return Response.json({
    ok: true,
    claimed: true,
    claim: serializeClaim(claim),
  });
}

/** @param {Request} request */
async function spinWheel(request) {
  const auth = await resolveProxyShop(request);
  if (!auth.ok) {
    return Response.json({ ok: false, error: auth.message }, { status: auth.status || 401 });
  }

  if (!hasLuckyWheelModels()) {
    return Response.json(
      { ok: false, error: "This offer is unavailable right now." },
      { status: 503 },
    );
  }

  let body = {};
  const contentType = request.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      body = await request.json();
    } else {
      const formData = await request.formData();
      body = Object.fromEntries(formData.entries());
    }
  } catch {
    return Response.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const validation = validateEmail(body?.email);
  if (!validation.ok) {
    return Response.json({ ok: false, error: "Enter a valid email address." }, { status: 400 });
  }

  const phoneResult = normalizePhone(body?.phone);
  if (!phoneResult.ok) {
    return Response.json({ ok: false, error: phoneResult.error }, { status: 400 });
  }

  const agreed =
    body?.agreed === true ||
    body?.agreed === "true" ||
    body?.agreed === "on" ||
    body?.agreed === "1";

  const email = validation.email.toLowerCase();
  const existing = await findClaimByEmail(auth.shop, email);
  if (existing) {
    return Response.json({
      ok: true,
      alreadyClaimed: true,
      claim: serializeClaim(existing),
    });
  }

  const setting = await getLuckyWheelSetting(auth.shop);
  if (setting.setupError || !setting.enabled) {
    return Response.json(
      { ok: false, error: "This offer is not open right now." },
      { status: 403 },
    );
  }

  const drawn = drawSector(setting.prizes);
  if (!drawn) {
    return Response.json(
      { ok: false, error: "Prize setup is invalid. Please contact the store." },
      { status: 500 },
    );
  }

  const couponCode = drawn.prize.couponCode;
  if (!couponCode) {
    return Response.json(
      { ok: false, error: "This prize is not available right now." },
      { status: 500 },
    );
  }

  try {
    const claim = await prisma.luckyWheelClaim.create({
      data: {
        shop: auth.shop,
        email,
        phone: phoneResult.phone,
        couponCode,
        percentOff: drawn.prize.percentOff,
        label: drawn.prize.label,
        sectorIndex: drawn.sectorIndex,
        shopifyDiscountId: null,
        agreedMarketing: agreed,
      },
    });

    try {
      await saveEmailForShop(auth.shop, email, null, "lucky-wheel");
    } catch (error) {
      console.error("[lucky-wheel-save-email]", error);
    }

    return Response.json({
      ok: true,
      alreadyClaimed: false,
      claim: serializeClaim(claim),
    });
  } catch (error) {
    if (error?.code === "P2002") {
      const raced = await findClaimByEmail(auth.shop, email);
      if (raced) {
        return Response.json({
          ok: true,
          alreadyClaimed: true,
          claim: serializeClaim(raced),
        });
      }
    }
    console.error("[lucky-wheel-claim]", error);
    return Response.json(
      { ok: false, error: "Could not save your spin. Please try again." },
      { status: 500 },
    );
  }
}

/**
 * Wheel art, clockwise from the left pointer:
 * 3% / 2% / 5% / 3% / 2% / 5%.
 * Probability is per prize, then one of the two matching sectors is chosen.
 * @param {Array<{ percentOff: number, probability: number, label: string }>} prizes
 */
export function drawSector(prizes) {
  const normalized = normalizePrizes(prizes);
  const prize = drawPrize(normalized);
  if (!prize) return null;
  const prizeIndex = normalized.indexOf(prize);
  if (prizeIndex < 0) return null;
  const sectorBase = [1, 0, 2][prizeIndex] ?? 0;
  const sectorIndex = sectorBase + (Math.random() < 0.5 ? 0 : PRIZE_COUNT);
  return {
    prize,
    sectorIndex: sectorIndex % SECTOR_COUNT,
  };
}

/** @param {Array<{ probability: number }>} prizes */
export function drawPrize(prizes) {
  const total = prizes.reduce((sum, prize) => sum + prize.probability, 0);
  if (total <= 0) return null;
  let ticket = Math.random() * total;
  for (const prize of prizes) {
    ticket -= prize.probability;
    if (ticket <= 0) return prize;
  }
  return prizes[prizes.length - 1] || null;
}

/** @param {string} shop @param {string} email */
async function findClaimByEmail(shop, email) {
  if (!hasLuckyWheelModels()) return null;
  try {
    return await prisma.luckyWheelClaim.findUnique({
      where: {
        shop_email: {
          shop,
          email: email.toLowerCase(),
        },
      },
    });
  } catch (error) {
    if (isMissingLuckyWheelTableError(error)) return null;
    throw error;
  }
}

/** @param {unknown} claim */
function serializeClaim(claim) {
  return {
    email: claim.email,
    couponCode: claim.couponCode,
    percentOff: Number(claim.percentOff),
    label: claim.label,
    sectorIndex: Number(claim.sectorIndex) || 0,
    createdAt: claim.createdAt?.toISOString?.() || null,
  };
}

/** @param {unknown} claim */
function serializeClaimAdmin(claim) {
  return {
    ...serializeClaim(claim),
    phone: claim.phone || "",
    createdLabel: claim.createdAt
      ? `${claim.createdAt.toISOString().replace("T", " ").slice(0, 19)} UTC`
      : "",
  };
}

/** @param {Request} request */
async function resolveProxyShop(request) {
  try {
    const { session } = await authenticate.public.appProxy(request);
    const shop = session?.shop || new URL(request.url).searchParams.get("shop");
    if (!shop) return { ok: false, status: 401, message: "Could not identify the store." };
    return { ok: true, shop };
  } catch (error) {
    if (error instanceof Response) {
      return {
        ok: false,
        status: 401,
        message: "App Proxy check failed. Test on the live storefront, not the theme editor preview.",
      };
    }
    throw error;
  }
}

/** @param {unknown} raw */
function normalizePhone(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return { ok: true, phone: null };
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) {
    return { ok: false, error: "Enter a valid phone number or leave it blank." };
  }
  if (trimmed.startsWith("+")) return { ok: true, phone: `+${digits}` };
  if (digits.length === 10) return { ok: true, phone: `+1${digits}` };
  if (digits.length === 11 && digits.startsWith("1")) return { ok: true, phone: `+${digits}` };
  return { ok: true, phone: `+${digits}` };
}

/** @param {unknown} raw */
function normalizeCouponCode(raw) {
  return String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .slice(0, 40);
}

/** @param {unknown} raw */
function normalizePrefix(raw) {
  let prefix = String(raw ?? "LW-").trim().toUpperCase();
  if (!prefix) prefix = "LW-";
  if (!prefix.endsWith("-")) prefix = `${prefix}-`;
  return prefix.slice(0, 20);
}

/** @param {unknown} raw */
function normalizePrizes(raw) {
  const defaults = defaultLuckyWheelPrizes();
  const list = Array.isArray(raw) ? raw : defaults;
  return defaults.map((fallback, index) => {
    const item = list[index] || {};
    const percentOff = clampNumber(item.percentOff, fallback.percentOff, 0, 100);
    const probability = clampNumber(item.probability, fallback.probability, 0, 100);
    const label = String(item.label || "").trim() || `Extra ${formatPercent(percentOff)}% OFF`;
    const couponCode = normalizeCouponCode(item.couponCode) || fallback.couponCode;
    return { percentOff, probability, label, couponCode };
  });
}

/** @param {unknown} value @param {number} fallback @param {number} min @param {number} max */
function clampNumber(value, fallback, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

/** @param {number} value */
function formatPercent(value) {
  const num = Number(value) || 0;
  if (Number.isInteger(num)) return String(num);
  return String(Math.round(num * 100) / 100);
}

/** @param {number} value */
function roundProbability(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

/** @param {Date | string | null | undefined} date */
function dateInputValue(date) {
  if (!date) return "";
  const pdtTime = new Date(new Date(date).getTime() + PDT_OFFSET_MINUTES * 60 * 1000);
  return pdtTime.toISOString().slice(0, 19);
}

/** @param {unknown} value */
function parsePdtDateInput(value) {
  const normalized = normalizePdtDateTimeInput(value);
  if (!normalized) return new Date(NaN);
  const [datePart, timePart] = normalized.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute, second] = timePart.split(":").map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour + 7, minute, second, 0));
}

/** @param {unknown} value */
function normalizePdtDateTimeInput(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const [datePart, rawTimePart = "00:00:00"] = raw.split("T");
  const timeParts = rawTimePart.split(":");
  const hour = timeParts[0] || "00";
  const minute = timeParts[1] || "00";
  const second = timeParts[2] || "00";
  return `${datePart}T${hour.padStart(2, "0")}:${minute.padStart(2, "0")}:${second.padStart(2, "0")}`;
}

function hasLuckyWheelModels() {
  return Boolean(prisma.luckyWheelSetting && prisma.luckyWheelClaim);
}

/** @param {unknown} error */
function isMissingLuckyWheelTableError(error) {
  return error?.code === "P2021" || String(error?.message || "").includes("LuckyWheel");
}
