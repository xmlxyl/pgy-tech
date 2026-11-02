import prisma from "../db.server";
import { authenticate, unauthenticated } from "../shopify.server";
import { saveEmailForShop, validateEmail } from "./saved-email.server";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_SUFFIX_LENGTH = 8;
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
    { percentOff: 2, probability: 60, label: "Extra 2% OFF" },
    { percentOff: 3, probability: 30, label: "Extra 3% OFF" },
    { percentOff: 5, probability: 10, label: "Extra 5% OFF" },
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

  if (!codePrefix) {
    return { ok: false, message: "优惠码前缀不能为空。" };
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

  if (!agreed) {
    return Response.json(
      { ok: false, error: "Please agree to receive emails to spin." },
      { status: 400 },
    );
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

  let admin;
  try {
    admin = await getAdminForShop(auth.shop);
  } catch (error) {
    console.error("[lucky-wheel-admin]", error);
    return Response.json(
      { ok: false, error: "Could not reach the store. Please try again." },
      { status: 500 },
    );
  }

  const customer = await findOrCreateCustomerByEmail(admin, email, {
    subscribeMarketing: agreed,
  });
  if (!customer?.id) {
    return Response.json(
      {
        ok: false,
        error: customer?.error || "Could not save this email. Please try again.",
      },
      { status: 500 },
    );
  }

  if (phoneResult.phone) {
    const phoneUpdate = await updateCustomerPhone(admin, customer.id, phoneResult.phone);
    if (!phoneUpdate.ok) {
      console.error("[lucky-wheel-phone]", phoneUpdate.error);
    }
  }

  let couponCode;
  let shopifyDiscountId = null;
  const startsAt = parsePdtDateInput(setting.codeStartsAt).toISOString();
  const endsAt = parsePdtDateInput(setting.codeEndsAt).toISOString();

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = await generateUniqueCouponCode(auth.shop, setting.codePrefix);
    const created = await createShopifyPercentDiscount(admin, {
      code: candidate,
      percentOff: drawn.prize.percentOff,
      email,
      customerId: customer.id,
      startsAt,
      endsAt,
    });

    if (created.ok) {
      couponCode = candidate;
      shopifyDiscountId = created.discountId;
      break;
    }

    if (created.duplicate) continue;

    console.error("[lucky-wheel-discount]", created.error);
    return Response.json(
      { ok: false, error: created.error || "Could not create the discount. Please try again." },
      { status: 500 },
    );
  }

  if (!couponCode) {
    return Response.json(
      { ok: false, error: "Could not create a unique code. Please try again." },
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
        shopifyDiscountId,
        agreedMarketing: agreed,
      },
    });

    if (agreed) {
      try {
        await saveEmailForShop(auth.shop, email, null, "lucky-wheel");
      } catch (error) {
        console.error("[lucky-wheel-save-email]", error);
      }
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
 * Three prizes are repeated across six sectors: 0/3, 1/4, 2/5.
 * Probability is per prize, then one of the two matching sectors is chosen.
 * @param {Array<{ percentOff: number, probability: number, label: string }>} prizes
 */
export function drawSector(prizes) {
  const normalized = normalizePrizes(prizes);
  const prize = drawPrize(normalized);
  if (!prize) return null;
  const prizeIndex = normalized.indexOf(prize);
  if (prizeIndex < 0) return null;
  const sectorIndex = prizeIndex + (Math.random() < 0.5 ? 0 : PRIZE_COUNT);
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

/** @param {string} shop @param {string} prefix */
async function generateUniqueCouponCode(shop, prefix) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = `${normalizePrefix(prefix)}${randomSuffix(CODE_SUFFIX_LENGTH)}`;
    const existing = await prisma.luckyWheelClaim.findUnique({
      where: { shop_couponCode: { shop, couponCode: code } },
    });
    if (!existing) return code;
  }
  throw new Error("Unable to generate unique coupon code");
}

/** @param {number} length */
function randomSuffix(length) {
  let result = "";
  for (let i = 0; i < length; i += 1) {
    result += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return result;
}

/**
 * @param {any} admin
 * @param {{
 *   code: string,
 *   percentOff: number,
 *   email: string,
 *   customerId: string,
 *   startsAt: string,
 *   endsAt: string,
 * }} input
 */
async function createShopifyPercentDiscount(admin, input) {
  const response = await admin.graphql(
    `#graphql
      mutation LuckyWheelDiscountCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
        discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
          codeDiscountNode {
            id
          }
          userErrors {
            field
            code
            message
          }
        }
      }`,
    {
      variables: {
        basicCodeDiscount: {
          title: `Lucky Wheel ${input.percentOff}% ${input.email}`.slice(0, 255),
          code: input.code,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          usageLimit: 1,
          appliesOncePerCustomer: true,
          context: {
            customers: {
              add: [input.customerId],
            },
          },
          customerGets: {
            value: {
              percentage: toShopifyPercentage(input.percentOff),
            },
            items: { all: true },
          },
          combinesWith: {
            orderDiscounts: true,
            productDiscounts: true,
            shippingDiscounts: true,
          },
        },
      },
    },
  );

  const json = await response.json();
  const payload = json.data?.discountCodeBasicCreate;
  const userError = payload?.userErrors?.[0];
  const graphqlError = json.errors?.[0]?.message;

  if (userError || graphqlError) {
    const message = userError?.message || graphqlError || "Discount create failed";
    const duplicate =
      /taken|already|exists|duplicate/i.test(message) || userError?.code === "TAKEN";
    return { ok: false, duplicate, error: message };
  }

  return {
    ok: true,
    discountId: payload?.codeDiscountNode?.id || null,
  };
}

/**
 * @param {any} admin
 * @param {string} email
 * @param {{ subscribeMarketing?: boolean }} [options]
 */
async function findOrCreateCustomerByEmail(admin, email, options = {}) {
  const normalized = String(email || "").trim().toLowerCase();
  const subscribeMarketing = Boolean(options.subscribeMarketing);
  if (!normalized) return { id: null, error: "Enter a valid email address." };

  try {
    let customer = null;
    const existing = await findCustomerByEmail(admin, normalized);
    if (existing?.id) {
      customer = { id: existing.id, email: existing.email || normalized };
    } else {
      const json = await adminGraphqlJson(
        admin,
        "lucky-wheel-customer-set",
        `#graphql
          mutation LuckyWheelCustomerSet($identifier: CustomerSetIdentifiers, $input: CustomerSetInput!) {
            customerSet(identifier: $identifier, input: $input) {
              customer {
                id
                defaultEmailAddress { emailAddress }
              }
              userErrors { field message code }
            }
          }`,
        {
          variables: {
            identifier: { email: normalized },
            input: { email: normalized },
          },
        },
      );

      const payload = json.data?.customerSet;
      const userError = payload?.userErrors?.[0];
      const graphqlMessage = firstGraphqlErrorMessage(json.errors);

      if (payload?.customer?.id) {
        customer = {
          id: payload.customer.id,
          email: payload.customer.defaultEmailAddress?.emailAddress || normalized,
        };
      } else if (
        userError &&
        /taken|already|exists|email|duplicate/i.test(
          `${userError.message || ""} ${userError.code || ""}`,
        )
      ) {
        const again = await findCustomerByEmail(admin, normalized);
        if (again?.id) customer = { id: again.id, email: again.email || normalized };
      }

      if (!customer?.id) {
        const message = userError?.message || graphqlMessage || "Could not create the customer.";
        if (/access denied|write_customers|protected customer/i.test(message)) {
          return {
            id: null,
            error: "Missing customer permission. Reopen the app and approve write_customers.",
          };
        }
        return { id: null, error: message };
      }
    }

    if (subscribeMarketing && customer?.id) {
      const marketing = await subscribeCustomerEmailMarketing(admin, customer.id);
      if (!marketing.ok) console.error("[lucky-wheel-marketing]", marketing.error);
    }

    return customer;
  } catch (error) {
    const message = firstGraphqlErrorMessage(extractGraphqlError(error)) || String(error?.message || error);
    if (/access denied|write_customers|protected customer/i.test(message)) {
      return {
        id: null,
        error: "Missing customer permission. Reopen the app and approve write_customers.",
      };
    }
    return { id: null, error: message || "Could not save this email." };
  }
}

/** @param {any} admin @param {string} customerId @param {string} phone */
async function updateCustomerPhone(admin, customerId, phone) {
  const json = await adminGraphqlJson(
    admin,
    "lucky-wheel-customer-phone",
    `#graphql
      mutation LuckyWheelCustomerPhone($input: CustomerInput!) {
        customerUpdate(input: $input) {
          customer { id }
          userErrors { field message }
        }
      }`,
    {
      variables: {
        input: { id: customerId, phone },
      },
    },
  );

  const payload = json.data?.customerUpdate;
  const userError = payload?.userErrors?.[0]?.message;
  const graphqlMessage = firstGraphqlErrorMessage(json.errors);
  if (payload?.customer?.id && !userError && !graphqlMessage) return { ok: true };
  return { ok: false, error: userError || graphqlMessage || "Could not save the phone number." };
}

/** @param {any} admin @param {string} customerId */
async function subscribeCustomerEmailMarketing(admin, customerId) {
  const json = await adminGraphqlJson(
    admin,
    "lucky-wheel-email-marketing",
    `#graphql
      mutation LuckyWheelEmailMarketingConsent($input: CustomerEmailMarketingConsentUpdateInput!) {
        customerEmailMarketingConsentUpdate(input: $input) {
          customer { id }
          userErrors { field message code }
        }
      }`,
    {
      variables: {
        input: {
          customerId,
          emailMarketingConsent: {
            marketingState: "SUBSCRIBED",
            marketingOptInLevel: "SINGLE_OPT_IN",
            consentUpdatedAt: new Date().toISOString(),
          },
        },
      },
    },
  );

  const payload = json.data?.customerEmailMarketingConsentUpdate;
  const userError = payload?.userErrors?.[0]?.message;
  const graphqlMessage = firstGraphqlErrorMessage(json.errors);
  if (payload?.customer?.id && !userError && !graphqlMessage) return { ok: true };
  return { ok: false, error: userError || graphqlMessage || "Could not subscribe the email." };
}

/** @param {any} admin @param {string} email */
async function findCustomerByEmail(admin, email) {
  const json = await adminGraphqlJson(
    admin,
    "lucky-wheel-customer-lookup",
    `#graphql
      query LuckyWheelCustomerByEmail($query: String!) {
        customers(first: 1, query: $query) {
          nodes {
            id
            defaultEmailAddress { emailAddress }
          }
        }
      }`,
    { variables: { query: `email:${email}` } },
  );

  const node = json.data?.customers?.nodes?.[0];
  if (!node?.id) return null;
  return {
    id: node.id,
    email: node.defaultEmailAddress?.emailAddress || email,
  };
}

/**
 * @param {any} admin
 * @param {string} label
 * @param {string} query
 * @param {{ variables?: Record<string, unknown> }} [options]
 */
async function adminGraphqlJson(admin, label, query, options) {
  try {
    const response = await admin.graphql(query, options);
    const json = await response.json();
    if (json?.errors) console.error(`[${label}]`, JSON.stringify(json.errors, null, 2));
    return json;
  } catch (error) {
    const extracted = extractGraphqlError(error);
    console.error(`[${label}]`, JSON.stringify(extracted, null, 2));
    return { data: null, errors: extracted };
  }
}

/** @param {unknown} error */
function extractGraphqlError(error) {
  return (
    error?.body?.errors?.graphQLErrors ||
    error?.body?.errors ||
    error?.errors?.graphQLErrors ||
    error?.errors ||
    error?.message ||
    String(error)
  );
}

/** @param {unknown} errors */
function firstGraphqlErrorMessage(errors) {
  if (!errors) return "";
  if (typeof errors === "string") return errors;
  if (Array.isArray(errors)) {
    const first = errors[0];
    if (typeof first === "string") return first;
    return String(first?.message || first?.extensions?.code || "");
  }
  if (typeof errors === "object" && errors.message) return String(errors.message);
  return "";
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

/** @param {string} shop */
async function getAdminForShop(shop) {
  const { admin } = await unauthenticated.admin(shop);
  return admin;
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
    return { percentOff, probability, label };
  });
}

/** @param {unknown} value @param {number} fallback @param {number} min @param {number} max */
function clampNumber(value, fallback, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

/** @param {number} percentOff */
function toShopifyPercentage(percentOff) {
  return Number((Number(percentOff) / 100).toFixed(4));
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
