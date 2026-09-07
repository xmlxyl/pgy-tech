import prisma from "../db.server";
import { authenticate, unauthenticated } from "../shopify.server";
import { saveEmailForShop, validateEmail } from "./saved-email.server";

export const COUPON_LOTTERY_PROXY_PATH = "/apps/pgy-tech/coupon-lottery";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_SUFFIX_LENGTH = 8;
const PDT_OFFSET_MINUTES = -7 * 60;

/** Default coupon window: Sep 18 00:00:00 ~ Sep 30 23:59:59 (PDT) */
export function defaultCouponValidity() {
  return {
    codeStartsAt: "2026-09-18T00:00:00",
    codeEndsAt: "2026-09-30T23:59:59",
  };
}

export function defaultCouponLotteryPrizes() {
  return [
    {
      minSpend: 20,
      discountAmount: 1.1,
      probability: 44,
      label: "$1.10",
    },
    {
      minSpend: 111,
      discountAmount: 5.5,
      probability: 33,
      label: "$5.50",
    },
    {
      minSpend: 159,
      discountAmount: 6.6,
      probability: 11,
      label: "$6.60",
    },
    {
      minSpend: 239,
      discountAmount: 11,
      probability: 11,
      label: "$11",
    },
    {
      minSpend: 329,
      discountAmount: 17,
      probability: 1,
      label: "$17",
    },
  ];
}

export function defaultCouponLotterySettings() {
  const validity = defaultCouponValidity();
  return {
    enabled: true,
    codePrefix: "PGY-",
    codeStartsAt: validity.codeStartsAt,
    codeEndsAt: validity.codeEndsAt,
    prizes: defaultCouponLotteryPrizes(),
    setupError: null,
  };
}

/** @param {string} shop */
export async function getCouponLotterySetting(shop) {
  const defaults = defaultCouponLotterySettings();
  if (!hasCouponLotteryModels()) {
    return {
      ...defaults,
      setupError:
        "数据库尚未更新优惠券抽奖功能，请先执行 prisma migrate deploy。",
    };
  }

  try {
    const setting = await prisma.couponLotterySetting.findUnique({
      where: { shop },
    });
    if (!setting) {
      return defaults;
    }
    return {
      enabled: Boolean(setting.enabled),
      codePrefix: normalizePrefix(setting.codePrefix),
      codeStartsAt: dateInputValue(setting.codeStartsAt) || defaults.codeStartsAt,
      codeEndsAt: dateInputValue(setting.codeEndsAt) || defaults.codeEndsAt,
      prizes: normalizePrizes(setting.prizes),
      setupError: null,
    };
  } catch (error) {
    if (isMissingCouponLotteryTableError(error)) {
      return {
        ...defaults,
        setupError:
          "数据库尚未更新优惠券抽奖功能，请先执行 prisma migrate deploy。",
      };
    }
    throw error;
  }
}

/**
 * @param {string} shop
 * @param {FormData} formData
 */
export async function saveCouponLotterySetting(shop, formData) {
  if (!hasCouponLotteryModels()) {
    return {
      ok: false,
      message:
        "数据库尚未更新优惠券抽奖功能，请先执行 prisma migrate deploy。",
    };
  }

  const enabled = formData.get("enabled") === "on" || formData.get("enabled") === "true";
  const codePrefix = normalizePrefix(formData.get("codePrefix"));
  const codeStartsAt = parsePdtDateInput(formData.get("codeStartsAt"));
  const codeEndsAt = parsePdtDateInput(formData.get("codeEndsAt"));
  const prizes = [];

  for (let index = 0; index < 5; index += 1) {
    prizes.push({
      minSpend: Number(formData.get(`minSpend${index}`)),
      discountAmount: Number(formData.get(`discountAmount${index}`)),
      probability: Number(formData.get(`probability${index}`)),
      label: String(formData.get(`label${index}`) || "").trim(),
    });
  }

  const normalized = normalizePrizes(prizes);
  const totalProbability = normalized.reduce(
    (sum, prize) => sum + prize.probability,
    0,
  );

  if (Math.abs(totalProbability - 100) > 0.001) {
    return {
      ok: false,
      message: `奖池概率之和必须为 100%，当前为 ${roundProbability(totalProbability)}%。`,
    };
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
    await prisma.couponLotterySetting.upsert({
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
    return { ok: true, message: "优惠券抽奖配置已保存。" };
  } catch (error) {
    if (isMissingCouponLotteryTableError(error)) {
      return {
        ok: false,
        message:
          "数据库尚未更新优惠券抽奖功能，请先执行 prisma migrate deploy。",
      };
    }
    console.error("[coupon-lottery-save]", error);
    return { ok: false, message: "保存失败，请稍后再试。" };
  }
}

/** @param {Request} request */
export async function handleCouponLotteryProxyRequest(request) {
  const method = request.method.toUpperCase();
  const url = new URL(request.url);
  const action = url.searchParams.get("action") || "config";

  if (method === "GET") {
    if (action === "status") {
      return getClaimStatus(request);
    }
    return getPublicConfig(request);
  }

  if (method === "POST") {
    return claimCoupon(request);
  }

  return Response.json({ ok: false, error: "Method not allowed" }, { status: 405 });
}

/** @param {Request} request */
async function getPublicConfig(request) {
  const auth = await resolveProxyShop(request);
  if (!auth.ok) {
    return Response.json(
      { ok: false, error: auth.message },
      { status: auth.status || 401 },
    );
  }

  const setting = await getCouponLotterySetting(auth.shop);
  return Response.json({
    ok: true,
    enabled: setting.enabled && !setting.setupError,
    codePrefix: setting.codePrefix,
    prizes: setting.prizes.map((prize) => ({
      minSpend: prize.minSpend,
      discountAmount: prize.discountAmount,
      label: prize.label || formatMoneyLabel(prize.discountAmount),
    })),
  });
}

/** @param {Request} request */
async function getClaimStatus(request) {
  const auth = await resolveProxyShop(request);
  if (!auth.ok) {
    return Response.json(
      { ok: false, error: auth.message },
      { status: auth.status || 401 },
    );
  }

  const emailRaw = new URL(request.url).searchParams.get("email");
  const validation = validateEmail(emailRaw);
  if (!validation.ok) {
    return Response.json(
      { ok: false, error: validation.error },
      { status: 400 },
    );
  }

  const claim = await findClaimByEmail(auth.shop, validation.email);
  if (!claim) {
    return Response.json({
      ok: true,
      claimed: false,
      claim: null,
    });
  }

  return Response.json({
    ok: true,
    claimed: true,
    claim: serializeClaim(claim),
  });
}

/** @param {Request} request */
async function claimCoupon(request) {
  const auth = await resolveProxyShop(request);
  if (!auth.ok) {
    return Response.json(
      { ok: false, error: auth.message },
      { status: auth.status || 401 },
    );
  }

  if (!hasCouponLotteryModels()) {
    return Response.json(
      { ok: false, error: "活动暂不可用，请稍后再试。" },
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
    return Response.json(
      { ok: false, error: "请求格式不正确。" },
      { status: 400 },
    );
  }

  const validation = validateEmail(body?.email);
  if (!validation.ok) {
    return Response.json(
      { ok: false, error: validation.error },
      { status: 400 },
    );
  }

  const agreed =
    body?.agreed === true ||
    body?.agreed === "true" ||
    body?.agreed === "on" ||
    body?.agreed === "1";

  const setting = await getCouponLotterySetting(auth.shop);
  if (setting.setupError || !setting.enabled) {
    return Response.json(
      { ok: false, error: "活动暂未开启。" },
      { status: 403 },
    );
  }

  const email = validation.email.toLowerCase();
  const existing = await findClaimByEmail(auth.shop, email);
  if (existing) {
    return Response.json({
      ok: true,
      alreadyClaimed: true,
      claim: serializeClaim(existing),
    });
  }

  const prize = drawPrize(setting.prizes);
  if (!prize) {
    return Response.json(
      { ok: false, error: "奖池配置无效，请联系商家。" },
      { status: 500 },
    );
  }

  let admin;
  try {
    admin = await getAdminForShop(auth.shop);
  } catch (error) {
    console.error("[coupon-lottery-admin]", error);
    return Response.json(
      { ok: false, error: "无法连接店铺，请稍后再试。" },
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
        error:
          customer?.error ||
          "无法绑定该邮箱客户，请确认应用已授权 write_customers 后再试。",
      },
      { status: 500 },
    );
  }

  let couponCode;
  let shopifyDiscountId = null;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = await generateUniqueCouponCode(auth.shop, setting.codePrefix);
    const created = await createShopifyDiscountCode(admin, {
      code: candidate,
      discountAmount: prize.discountAmount,
      minSpend: prize.minSpend,
      email,
      customerId: customer.id,
      startsAt: parsePdtDateInput(setting.codeStartsAt).toISOString(),
      endsAt: parsePdtDateInput(setting.codeEndsAt).toISOString(),
    });

    if (created.ok) {
      couponCode = candidate;
      shopifyDiscountId = created.discountId;
      break;
    }

    if (created.duplicate) {
      continue;
    }

    console.error("[coupon-lottery-discount]", created.error);
    return Response.json(
      { ok: false, error: created.error || "创建优惠码失败，请稍后再试。" },
      { status: 500 },
    );
  }

  if (!couponCode) {
    return Response.json(
      { ok: false, error: "优惠码生成失败，请稍后再试。" },
      { status: 500 },
    );
  }

  try {
    const claim = await prisma.couponLotteryClaim.create({
      data: {
        shop: auth.shop,
        email,
        couponCode,
        discountAmount: prize.discountAmount,
        minSpend: prize.minSpend,
        shopifyDiscountId,
        agreedMarketing: agreed,
      },
    });

    if (agreed) {
      try {
        await saveEmailForShop(auth.shop, email, null);
      } catch (error) {
        console.error("[coupon-lottery-save-email]", error);
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
    console.error("[coupon-lottery-claim]", error);
    return Response.json(
      { ok: false, error: "领取失败，请稍后再试。" },
      { status: 500 },
    );
  }
}

/** @param {string} shop @param {string} email */
async function findClaimByEmail(shop, email) {
  if (!hasCouponLotteryModels()) return null;
  try {
    return await prisma.couponLotteryClaim.findUnique({
      where: {
        shop_email: {
          shop,
          email: email.toLowerCase(),
        },
      },
    });
  } catch (error) {
    if (isMissingCouponLotteryTableError(error)) return null;
    throw error;
  }
}

/** @param {unknown} claim */
function serializeClaim(claim) {
  return {
    email: claim.email,
    couponCode: claim.couponCode,
    discountAmount: Number(claim.discountAmount),
    minSpend: Number(claim.minSpend),
    label: formatMoneyLabel(Number(claim.discountAmount)),
    createdAt: claim.createdAt?.toISOString?.() || null,
  };
}

/** @param {Array<{probability: number}>} prizes */
export function drawPrize(prizes) {
  const normalized = normalizePrizes(prizes);
  const total = normalized.reduce((sum, prize) => sum + prize.probability, 0);
  if (total <= 0) return null;

  let ticket = Math.random() * total;
  for (const prize of normalized) {
    ticket -= prize.probability;
    if (ticket <= 0) return prize;
  }
  return normalized[normalized.length - 1] || null;
}

/** @param {string} shop @param {string} prefix */
async function generateUniqueCouponCode(shop, prefix) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = `${normalizePrefix(prefix)}${randomSuffix(CODE_SUFFIX_LENGTH)}`;
    const existing = await prisma.couponLotteryClaim.findUnique({
      where: {
        shop_couponCode: {
          shop,
          couponCode: code,
        },
      },
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
 *   discountAmount: number,
 *   minSpend: number,
 *   email: string,
 *   customerId: string,
 *   startsAt: string,
 *   endsAt: string,
 * }} input
 */
async function createShopifyDiscountCode(admin, input) {
  const response = await admin.graphql(
    `#graphql
      mutation CouponLotteryDiscountCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
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
          title: `Anniversary Coupon ${input.email}`,
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
              discountAmount: {
                amount: String(roundMoney(input.discountAmount)),
                appliesOnEachItem: false,
              },
            },
            items: { all: true },
          },
          minimumRequirement: {
            subtotal: {
              greaterThanOrEqualToSubtotal: String(roundMoney(input.minSpend)),
            },
          },
          combinesWith: {
            orderDiscounts: false,
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
      /taken|already|exists|duplicate/i.test(message) ||
      userError?.code === "TAKEN";
    return { ok: false, duplicate, error: message };
  }

  return {
    ok: true,
    discountId: payload?.codeDiscountNode?.id || null,
  };
}

/**
 * Ensure a Shopify customer exists for the claiming email so the discount
 * can be locked to that customer only.
 * @param {any} admin
 * @param {string} email
 * @param {{ subscribeMarketing?: boolean }} [options]
 */
async function findOrCreateCustomerByEmail(admin, email, options = {}) {
  const normalized = String(email || "").trim().toLowerCase();
  const subscribeMarketing = Boolean(options.subscribeMarketing);
  if (!normalized) {
    return { id: null, error: "邮箱无效。" };
  }

  try {
    let customer = null;
    const existing = await findCustomerByEmail(admin, normalized);
    if (existing?.id) {
      customer = {
        id: existing.id,
        email: existing.email || normalized,
      };
    } else {
      const json = await adminGraphqlJson(
        admin,
        "coupon-lottery-customer-set",
        `#graphql
          mutation CouponLotteryCustomerSet($identifier: CustomerSetIdentifiers, $input: CustomerSetInput!) {
            customerSet(identifier: $identifier, input: $input) {
              customer {
                id
                defaultEmailAddress {
                  emailAddress
                }
              }
              userErrors {
                field
                message
                code
              }
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
          email:
            payload.customer.defaultEmailAddress?.emailAddress || normalized,
        };
      } else if (
        userError &&
        /taken|already|exists|email|duplicate/i.test(
          `${userError.message || ""} ${userError.code || ""}`,
        )
      ) {
        const again = await findCustomerByEmail(admin, normalized);
        if (again?.id) {
          customer = {
            id: again.id,
            email: again.email || normalized,
          };
        }
      }

      if (!customer?.id) {
        const message =
          userError?.message || graphqlMessage || "创建客户失败。";
        console.error("[coupon-lottery-customer-set]", {
          userError,
          graphqlMessage,
          errors: json.errors,
        });

        if (/access denied|write_customers|protected customer/i.test(message)) {
          return {
            id: null,
            error:
              "缺少客户写入权限。请重新打开 App 授权 write_customers 后再试。",
          };
        }

        return { id: null, error: message };
      }
    }

    if (subscribeMarketing && customer?.id) {
      const marketing = await subscribeCustomerEmailMarketing(
        admin,
        customer.id,
      );
      if (!marketing.ok) {
        console.error("[coupon-lottery-marketing]", marketing.error);
        // Don't block coupon claim if marketing subscribe fails.
      }
    }

    return customer;
  } catch (error) {
    const extracted = extractGraphqlError(error);
    console.error(
      "[coupon-lottery-customer]",
      JSON.stringify(extracted, null, 2),
    );
    const message = firstGraphqlErrorMessage(extracted) || String(error?.message || error);
    if (/access denied|write_customers|protected customer/i.test(message)) {
      return {
        id: null,
        error:
          "缺少客户写入权限。请重新打开 App 授权 write_customers 后再试。",
      };
    }
    return { id: null, error: message || "绑定邮箱客户失败，请稍后再试。" };
  }
}

/**
 * @param {any} admin
 * @param {string} customerId
 */
async function subscribeCustomerEmailMarketing(admin, customerId) {
  const json = await adminGraphqlJson(
    admin,
    "coupon-lottery-email-marketing",
    `#graphql
      mutation CouponLotteryEmailMarketingConsent($input: CustomerEmailMarketingConsentUpdateInput!) {
        customerEmailMarketingConsentUpdate(input: $input) {
          customer {
            id
          }
          userErrors {
            field
            message
            code
          }
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

  if (payload?.customer?.id && !userError && !graphqlMessage) {
    return { ok: true };
  }

  return {
    ok: false,
    error: userError || graphqlMessage || "订阅邮件失败",
  };
}

/** @param {any} admin @param {string} email */
async function findCustomerByEmail(admin, email) {
  const json = await adminGraphqlJson(
    admin,
    "coupon-lottery-customer-lookup",
    `#graphql
      query CouponLotteryCustomerByEmail($query: String!) {
        customers(first: 1, query: $query) {
          nodes {
            id
            defaultEmailAddress {
              emailAddress
            }
          }
        }
      }`,
    {
      variables: {
        query: `email:${email}`,
      },
    },
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
    if (json?.errors) {
      console.error(`[${label}]`, JSON.stringify(json.errors, null, 2));
    }
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
  if (typeof errors === "object" && errors.message) {
    return String(errors.message);
  }
  return "";
}

/** @param {Request} request */
async function resolveProxyShop(request) {
  try {
    const { session } = await authenticate.public.appProxy(request);
    const shop = session?.shop || new URL(request.url).searchParams.get("shop");
    if (!shop) {
      return { ok: false, status: 401, message: "无法识别店铺。" };
    }
    return { ok: true, shop };
  } catch (error) {
    if (error instanceof Response) {
      return {
        ok: false,
        status: 401,
        message:
          "App Proxy 验证失败。请在店铺前台页面测试（非主题编辑器预览），并确认应用已安装。",
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
function normalizePrefix(raw) {
  let prefix = String(raw ?? "PGY-").trim().toUpperCase();
  if (!prefix) prefix = "PGY-";
  if (!prefix.endsWith("-")) prefix = `${prefix}-`;
  return prefix.slice(0, 20);
}

/** @param {unknown} raw */
function normalizePrizes(raw) {
  const defaults = defaultCouponLotteryPrizes();
  const list = Array.isArray(raw) ? raw : defaults;

  return defaults.map((fallback, index) => {
    const item = list[index] || {};
    const minSpend = toPositiveNumber(item.minSpend, fallback.minSpend);
    const discountAmount = toPositiveNumber(
      item.discountAmount,
      fallback.discountAmount,
    );
    const probability = toPositiveNumber(item.probability, fallback.probability);
    const label =
      String(item.label || "").trim() || formatMoneyLabel(discountAmount);
    return { minSpend, discountAmount, probability, label };
  });
}

/** @param {unknown} value @param {number} fallback */
function toPositiveNumber(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return fallback;
  return num;
}

/** @param {number} amount */
function formatMoneyLabel(amount) {
  const value = Number(amount) || 0;
  if (Number.isInteger(value)) return `$${value}`;
  return `$${value.toFixed(2)}`;
}

/** @param {number} amount */
function roundMoney(amount) {
  return Math.round(Number(amount) * 100) / 100;
}

/** @param {number} value */
function roundProbability(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

/** @param {Date | string | null | undefined} date */
function dateInputValue(date) {
  if (!date) return "";
  const pdtTime = new Date(
    new Date(date).getTime() + PDT_OFFSET_MINUTES * 60 * 1000,
  );
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

function hasCouponLotteryModels() {
  return Boolean(prisma.couponLotterySetting && prisma.couponLotteryClaim);
}

/** @param {unknown} error */
function isMissingCouponLotteryTableError(error) {
  return (
    error?.code === "P2021" ||
    String(error?.message || "").includes("CouponLottery")
  );
}
