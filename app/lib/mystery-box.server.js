import prisma from "../db.server";
import { authenticate, unauthenticated } from "../shopify.server";

export const MYSTERY_BOX_PROXY_PATH = "/apps/pgy-tech/mystery-box";
export const DEFAULT_FEISHU_WEBHOOK =
  "https://open.feishu.cn/open-apis/bot/v2/hook/37fe7acc-9e7b-4a13-8cef-7c6e2100f0c8";
export const DEFAULT_MIN_ORDER_AMOUNT = 0;
const CLAIMED_ORDER_TAG = "8月盲盒活动中奖";

const BEIJING_OFFSET_MINUTES = 8 * 60;

const DEFAULT_RULES = {
  prizes: [
    { sku: "", title: "", imageUrl: "", imageAlt: "", probability: 0 },
    { sku: "", title: "", imageUrl: "", imageAlt: "", probability: 0 },
    { sku: "", title: "", imageUrl: "", imageAlt: "", probability: 0 },
  ],
  noPrizeProbability: 100,
};

export function defaultMysteryBoxSettings() {
  return {
    startDate: "",
    minOrderAmount: DEFAULT_MIN_ORDER_AMOUNT,
    webhookUrl: DEFAULT_FEISHU_WEBHOOK,
    usRules: DEFAULT_RULES,
    intlRules: DEFAULT_RULES,
  };
}

export async function getMysteryBoxSetting(shop) {
  const defaults = defaultMysteryBoxSettings();
  if (!hasMysteryBoxModels()) {
    return {
      exists: false,
      setupError:
        "Prisma Client does not include the lucky box models yet. Run the database migration and regenerate Prisma Client.",
      ...defaults,
    };
  }

  let setting;
  try {
    setting = await prisma.mysteryBoxSetting.findUnique({ where: { shop } });
  } catch (error) {
    if (isMissingMysteryBoxTableError(error)) {
      return {
        exists: false,
        setupError:
          "The lucky box database tables have not been created yet. Run npm run db:deploy first.",
        ...defaults,
      };
    }
    throw error;
  }
  if (!setting) return { exists: false, ...defaults };

  return {
    exists: true,
    startDate: dateInputValue(setting.startDate),
    minOrderAmount: Number(setting.minOrderAmount),
    webhookUrl: setting.webhookUrl || defaults.webhookUrl,
    usRules: normalizeRules(setting.usRules),
    intlRules: normalizeRules(setting.intlRules),
  };
}

export async function saveMysteryBoxSetting(shop, formData, admin) {
  if (!hasMysteryBoxModels()) {
    return {
      ok: false,
      message:
        "Prisma Client does not include the lucky box models yet. Run npm run db:deploy and npx prisma generate, then restart the app.",
    };
  }

  const startDateRaw = String(formData.get("startDate") || "").trim();
  const startDate = parseBeijingDateInput(startDateRaw);
  const minOrderAmount = Number(formData.get("minOrderAmount") || 0);
  const webhookUrl = String(formData.get("webhookUrl") || "").trim();
  const usRules = normalizeRulesFromForm(formData, "us");
  const intlRules = normalizeRulesFromForm(formData, "intl");

  if (Number.isNaN(startDate.getTime())) {
    return { ok: false, message: "Start date is invalid." };
  }
  if (!Number.isFinite(minOrderAmount) || minOrderAmount <= 0) {
    return {
      ok: false,
      message: "Minimum order amount must be greater than 0.",
    };
  }

  const validationError = validateRules(usRules, "US rules");
  if (validationError) return { ok: false, message: validationError };
  const intlValidationError = validateRules(intlRules, "Non-US rules");
  if (intlValidationError) return { ok: false, message: intlValidationError };

  const enrichedUsRules = await enrichRulesWithVariantData(admin, usRules);
  const enrichedIntlRules = await enrichRulesWithVariantData(admin, intlRules);

  try {
    await prisma.mysteryBoxSetting.upsert({
      where: { shop },
      create: {
        shop,
        startDate,
        minOrderAmount,
        webhookUrl,
        usRules: enrichedUsRules,
        intlRules: enrichedIntlRules,
      },
      update: {
        startDate,
        minOrderAmount,
        webhookUrl,
        usRules: enrichedUsRules,
        intlRules: enrichedIntlRules,
      },
    });
  } catch (error) {
    if (isMissingMysteryBoxTableError(error)) {
      return {
        ok: false,
        message:
          "The lucky box database tables have not been created yet. Run npm run db:deploy first.",
      };
    }
    throw error;
  }

  return { ok: true, message: "Lucky box settings saved." };
}

export async function getMysteryBoxPageData(request) {
  const auth = await resolveProxyShop(request);
  if (!auth.ok) return auth;

  const customerId = getProxyCustomerId(request);
  if (!hasMysteryBoxModels()) {
    return {
      ok: true,
      status: "not_configured",
      shop: auth.shop,
      customerId,
      setupError:
        "The app database has not been updated for the lucky box feature yet.",
    };
  }

  let setting;
  try {
    setting = await prisma.mysteryBoxSetting.findUnique({
      where: { shop: auth.shop },
    });
  } catch (error) {
    if (isMissingMysteryBoxTableError(error)) {
      return {
        ok: true,
        status: "not_configured",
        shop: auth.shop,
        customerId,
        setupError:
          "The app database has not been updated for the lucky box feature yet.",
      };
    }
    throw error;
  }

  if (!setting) {
    return {
      ok: true,
      status: "not_configured",
      shop: auth.shop,
      customerId,
    };
  }

  const region = detectRegion(request);
  const admin = await getAdminForShop(auth.shop);
  let currentRules = normalizeRules(
    region === "US" ? setting.usRules : setting.intlRules,
  );
  try {
    currentRules = await enrichMissingRuleImages(admin, currentRules);
  } catch (error) {
    console.error("[mystery-box-rule-images]", error);
  }

  let eligibleOrders = [];
  if (customerId) {
    try {
      eligibleOrders = await findEligibleOrders(admin, customerId, setting);
    } catch (error) {
      console.error("[mystery-box-eligible-orders]", error);
    }
  }
  const existingDraws = eligibleOrders.length
    ? await prisma.mysteryBoxDraw.findMany({
        where: {
          shop: auth.shop,
          orderId: { in: eligibleOrders.map((order) => order.id) },
        },
      })
    : [];
  const drawnOrderIds = new Set(existingDraws.map((draw) => draw.orderId));
  const availableOrders = eligibleOrders.filter(
    (order) => !drawnOrderIds.has(order.id),
  );

  return {
    ok: true,
    status: customerId ? "ready" : "login_required",
    shop: auth.shop,
    customerId,
    region,
    currentRules,
    minOrderAmount: Number(setting.minOrderAmount),
    startDate: dateInputValue(setting.startDate),
    eligibleOrder: availableOrders[0] || eligibleOrders[0] || null,
    eligibleOrders,
    availableOrders,
    existingDraw: existingDraws[0] ? serializeDraw(existingDraws[0]) : null,
    existingDraws: existingDraws.map(serializeDraw),
    totalEligibleCount: eligibleOrders.length,
    availableDrawCount: availableOrders.length,
    usedDrawCount: existingDraws.length,
  };
}

export async function drawMysteryBoxPrize(request) {
  const auth = await resolveProxyShop(request);
  if (!auth.ok) return auth;

  const customerId = getProxyCustomerId(request);
  if (!hasMysteryBoxModels()) {
    return {
      ok: false,
      status: 503,
      message: "Lucky box database is not initialized yet. Please try later.",
    };
  }

  if (!customerId) {
    return {
      ok: false,
      status: 401,
      message: "Please log in before opening a lucky box.",
    };
  }

  let setting;
  try {
    setting = await prisma.mysteryBoxSetting.findUnique({
      where: { shop: auth.shop },
    });
  } catch (error) {
    if (isMissingMysteryBoxTableError(error)) {
      return {
        ok: false,
        status: 503,
        message: "Lucky box database is not initialized yet. Please try later.",
      };
    }
    throw error;
  }
  if (!setting) {
    return { ok: false, status: 404, message: "Lucky box is not configured." };
  }

  const admin = await getAdminForShop(auth.shop);
  let eligibleOrders = [];
  try {
    eligibleOrders = await findEligibleOrders(admin, customerId, setting);
  } catch (error) {
    console.error("[mystery-box-draw-eligible-orders]", error);
    return {
      ok: false,
      status: 403,
      message:
        "Unable to check eligible orders right now. Please refresh and try again.",
    };
  }
  if (!eligibleOrders.length) {
    return {
      ok: false,
      status: 403,
      message: `No paid orders found from ${dateInputValue(
        setting.startDate,
      )} that meet the configured amount.`,
    };
  }

  const existingDraws = await prisma.mysteryBoxDraw.findMany({
    where: {
      shop: auth.shop,
      orderId: { in: eligibleOrders.map((order) => order.id) },
    },
  });
  const drawnOrderIds = new Set(existingDraws.map((draw) => draw.orderId));
  const eligibleOrder = eligibleOrders.find(
    (order) => !drawnOrderIds.has(order.id),
  );
  if (!eligibleOrder) {
    return {
      ok: true,
      alreadyDrawn: true,
      draw: serializeDraw(existingDraws[0]),
      remainingDrawCount: 0,
      totalEligibleCount: eligibleOrders.length,
    };
  }

  const region = detectRegion(request);
  const rules = normalizeRules(region === "US" ? setting.usRules : setting.intlRules);
  const prize = pickPrize(rules);
  const ipAddress = getClientIp(request);
  const draw = await prisma.mysteryBoxDraw.create({
    data: {
      shop: auth.shop,
      orderId: eligibleOrder.id,
      orderName: eligibleOrder.name,
      customerId,
      region,
      prizeType: prize.type,
      prizeSku: prize.sku || null,
      prizeTitle: prize.title || null,
      orderTotal: eligibleOrder.total,
      ipAddress,
    },
  });

  const autoAddedToOrder = await addPrizeVariantToOrder(admin, eligibleOrder, draw);
  const shopDomain = await getShopDisplayDomain(admin, auth.shop);
  const orderContact = await getOrderCustomerContactInfo(
    admin,
    eligibleOrder.id,
  );
  await notifyFeishu(setting.webhookUrl || DEFAULT_FEISHU_WEBHOOK, {
    shopDomain,
    order: {
      ...eligibleOrder,
      customerName: orderContact.name || eligibleOrder.customerName,
      contactInfo: orderContact.contactInfo || eligibleOrder.contactInfo,
    },
    region,
    draw,
    autoAddedToOrder,
  });

  return {
    ok: true,
    alreadyDrawn: false,
    draw: serializeDraw(draw),
    order: eligibleOrder,
    remainingDrawCount: Math.max(
      0,
      eligibleOrders.length - existingDraws.length - 1,
    ),
    totalEligibleCount: eligibleOrders.length,
  };
}

export async function getMysteryBoxEntryStatus(request) {
  const url = new URL(request.url);
  const auth = await resolveEntryShop(request);
  if (!auth.ok) {
    return { ok: false, show: false, message: auth.message };
  }

  const setting = await getMysteryBoxSetting(auth.shop);
  if (!setting) {
    return { ok: true, show: false, message: "Lucky box is not configured." };
  }

  const minOrderAmount = Number(setting.minOrderAmount || 0);
  const orderId = url.searchParams.get("order_id");
  const orderName = url.searchParams.get("order_name");
  const totalParam = Number(url.searchParams.get("total") || 0);
  console.log("===== mystery-box-entry-tag 1 request", {
    shop: auth.shop,
    orderId,
    orderName,
    totalParam,
    currency: url.searchParams.get("currency") || "",
    minOrderAmount,
  });

  if (!orderId && !orderName) {
    return buildMysteryBoxEntryResponse({
      qualifies: false,
      minOrderAmount,
    });
  }

  const admin = await getAdminForShop(auth.shop);
  const order = await getOrderTagSummarySafe(admin, { orderId, orderName });
  if (!order) {
    return buildMysteryBoxEntryResponse({
      qualifies: totalParam >= minOrderAmount,
      orderName,
      orderTotal: totalParam,
      currencyCode: url.searchParams.get("currency") || "",
      minOrderAmount,
    });
  }

  const alreadyDrawn = order.tags.includes(CLAIMED_ORDER_TAG);
  console.log("===== mystery-box-entry-tag 2 result", {
    orderId: order.id,
    orderName: order.name,
    tags: order.tags,
    alreadyDrawn,
  });

  return buildMysteryBoxEntryResponse({
    qualifies: alreadyDrawn || order.total >= minOrderAmount,
    alreadyDrawn,
    orderName: order.name,
    orderTotal: order.total,
    currencyCode: order.currencyCode,
    minOrderAmount,
  });
}

export async function getMysteryBoxEntryTagStatus(request, sessionToken) {
  const url = new URL(request.url);
  const shop = normalizeSessionTokenShop(sessionToken);
  if (!shop) {
    return { ok: false, show: false, message: "Unable to identify shop." };
  }

  const setting = await getMysteryBoxSetting(shop);
  if (!setting) {
    return { ok: true, show: false, message: "Lucky box is not configured." };
  }

  const minOrderAmount = Number(setting.minOrderAmount || 0);
  const orderId = url.searchParams.get("order_id");
  const totalParam = Number(url.searchParams.get("total") || 0);
  const currencyCode = url.searchParams.get("currency") || "";

  console.log("===== mystery-box-entry-token 1 request", {
    shop,
    orderId,
    orderName: url.searchParams.get("order_name"),
    totalParam,
    currencyCode,
    minOrderAmount,
  });

  if (!orderId) {
    return buildMysteryBoxEntryResponse({
      qualifies: totalParam >= minOrderAmount,
      orderTotal: totalParam,
      currencyCode,
      minOrderAmount,
    });
  }

  const admin = await getAdminForShop(shop);
  const order = await getOrderTagsById(admin, orderId);
  if (!order) {
    return buildMysteryBoxEntryResponse({
      qualifies: totalParam >= minOrderAmount,
      orderTotal: totalParam,
      currencyCode,
      minOrderAmount,
    });
  }

  const alreadyDrawn = order.tags.includes(CLAIMED_ORDER_TAG);
  console.log("===== mystery-box-entry-token 2 order-tags", {
    orderId: order.id,
    orderName: order.name,
    tags: order.tags,
    alreadyDrawn,
  });

  return buildMysteryBoxEntryResponse({
    qualifies: alreadyDrawn || order.total >= minOrderAmount,
    alreadyDrawn,
    orderName: order.name,
    orderTotal: order.total,
    currencyCode: order.currencyCode,
    minOrderAmount,
  });
}

export async function getMysteryBoxEntryDrawStatus(request, sessionToken = null) {
  const url = new URL(request.url);
  const shop =
    url.searchParams.get("shop") || normalizeSessionTokenShop(sessionToken) || "";
  if (!shop) {
    return { ok: false, show: false, message: "Unable to identify shop." };
  }

  const setting = await getMysteryBoxSetting(shop);
  if (!setting) {
    return { ok: true, show: false, message: "Lucky box is not configured." };
  }

  const minOrderAmount = Number(setting.minOrderAmount || 0);
  const orderId = url.searchParams.get("order_id");
  const orderName = url.searchParams.get("order_name") || "";
  const totalParam = Number(url.searchParams.get("total") || 0);
  const currencyCode = url.searchParams.get("currency") || "";

  console.log("===== mystery-box-entry-draw 1 request", {
    shop,
    orderId,
    orderName,
    totalParam,
    currencyCode,
    minOrderAmount,
  });

  if (!orderId || !hasMysteryBoxModels()) {
    return buildMysteryBoxEntryResponse({
      qualifies: totalParam >= minOrderAmount,
      orderName,
      orderTotal: totalParam,
      currencyCode,
      minOrderAmount,
    });
  }

  const draw = await prisma.mysteryBoxDraw.findFirst({
    where: { shop, orderId },
  });
  const alreadyDrawn = Boolean(draw);

  console.log("===== mystery-box-entry-draw 2 result", {
    shop,
    orderId,
    orderName,
    drawId: draw?.id || null,
    drawOrderName: draw?.orderName || null,
    alreadyDrawn,
  });

  return buildMysteryBoxEntryResponse({
    qualifies: alreadyDrawn || totalParam >= minOrderAmount,
    alreadyDrawn,
    orderName: draw?.orderName || orderName,
    orderTotal: draw ? Number(draw.orderTotal) : totalParam,
    currencyCode,
    minOrderAmount,
  });
}

export async function getMysteryBoxEntryConfig(request, sessionToken = null) {
  const url = new URL(request.url);
  const shop =
    url.searchParams.get("shop") || normalizeSessionTokenShop(sessionToken) || "";
  if (!shop) {
    return { ok: false, message: "Unable to identify shop." };
  }

  const setting = await getMysteryBoxSetting(shop);
  const startDate = setting.exists ? setting.startDate : "";
  return {
    ok: true,
    exists: Boolean(setting.exists),
    shop,
    startDate,
    startDateBeijing: startDate ? `${startDate}T00:00:00+08:00` : "",
    minOrderAmount: Number(setting.minOrderAmount || 0),
  };
}

function normalizeSessionTokenShop(sessionToken) {
  const dest = String(sessionToken?.dest || "");
  if (!dest) return "";

  try {
    return new URL(dest).host;
  } catch {
    return dest.replace(/^https?:\/\//, "").replace(/\/$/, "");
  }
}

async function resolveEntryShop(request) {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  if (shop) return { ok: true, shop };
  return resolveProxyShop(request);
}

function buildMysteryBoxEntryResponse({
  qualifies,
  alreadyDrawn = false,
  orderName = "",
  orderTotal = 0,
  currencyCode = "",
  minOrderAmount,
}) {
  const message = alreadyDrawn
    ? "You've already claimed your reward for this order. Thank you for participating!"
    : qualifies
      ? "Congratulations! Your purchase unlocks an exclusive reward. Open your mystery box now."
      : `Orders over ${minOrderAmount} can earn one lucky box draw chance.`;

  return {
    ok: true,
    show: qualifies,
    alreadyDrawn,
    buttonVisible: qualifies && !alreadyDrawn,
    orderName,
    orderTotal,
    currencyCode,
    minOrderAmount,
    message,
    buttonLabel: "Open Mystery Box",
    url: MYSTERY_BOX_PROXY_PATH,
  };
}

function orderNameCandidates(value) {
  const name = String(value || "").trim();
  if (!name) return [];
  const withoutHash = name.replace(/^#/, "");
  return [name, `#${withoutHash}`, withoutHash];
}

async function getOrderTagSummarySafe(admin, { orderId, orderName }) {
  try {
    return await getOrderTagSummary(admin, { orderId, orderName });
  } catch (error) {
    console.error("[mystery-box-entry-order-tags]", error);
    return null;
  }
}

async function resolveProxyShop(request) {
  try {
    const { session } = await authenticate.public.appProxy(request);
    const shop = session?.shop || new URL(request.url).searchParams.get("shop");
    if (!shop) {
      return { ok: false, status: 200, message: "Unable to identify shop." };
    }
    return { ok: true, shop };
  } catch (error) {
    if (error instanceof Response) {
      return { ok: false, status: 200, message: "App Proxy validation failed." };
    }
    throw error;
  }
}

async function getAdminForShop(shop) {
  await logStoredSessionScopes(shop);
  const { admin } = await unauthenticated.admin(shop);
  return admin;
}

async function logStoredSessionScopes(shop) {
  const sessions = await prisma.session.findMany({
    where: { shop },
    select: { id: true, isOnline: true, scope: true },
  });
  console.log(
    "[mystery-box-session-scopes]",
    JSON.stringify(
      sessions.map((session) => ({
        id: session.id,
        isOnline: session.isOnline,
        scope: session.scope,
      })),
      null,
      2,
    ),
  );
}

function getProxyCustomerId(request) {
  return new URL(request.url).searchParams.get("logged_in_customer_id");
}

function detectRegion(request) {
  const country =
    request.headers.get("cf-ipcountry") ||
    request.headers.get("x-vercel-ip-country") ||
    request.headers.get("x-country-code") ||
    "";
  return country.toUpperCase() === "US" ? "US" : "INTL";
}

function getClientIp(request) {
  const forwarded = request.headers.get("x-forwarded-for");
  return (
    forwarded?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    null
  );
}

async function findEligibleOrders(admin, customerId, setting) {
  const startDate = new Date(setting.startDate).toISOString();
  const query = `customer_id:${customerId} created_at:>=${startDate} financial_status:paid status:any`;
  const orders = [];
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const json = await adminGraphqlJson(
      admin,
      "mystery-box-eligible-orders",
      `#graphql
        query MysteryBoxEligibleOrders($query: String!, $cursor: String) {
          orders(first: 50, after: $cursor, sortKey: CREATED_AT, reverse: true, query: $query) {
            nodes {
              id
              name
              createdAt
              note
              displayFinancialStatus
              currentTotalPriceSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }`,
      { variables: { query, cursor } },
    );
    const connection = json.data?.orders;
    orders.push(...(connection?.nodes || []));
    hasNextPage = Boolean(connection?.pageInfo?.hasNextPage);
    cursor = connection?.pageInfo?.endCursor || null;
    if (!cursor) hasNextPage = false;
  }

  const minOrderAmount = Number(setting.minOrderAmount);

  return orders
    .map((order) => ({
      id: order.id,
      name: order.name,
      createdAt: order.createdAt,
      note: order.note || "",
      customerName: "",
      contactInfo: "",
      total: Number(order.currentTotalPriceSet?.shopMoney?.amount || 0),
      currencyCode: order.currentTotalPriceSet?.shopMoney?.currencyCode || "",
    }))
    .filter((order) => order.total >= minOrderAmount);
}

async function getOrderTagSummary(admin, { orderId, orderName }) {
  if (orderId) {
    const order = await getOrderTagSummaryById(admin, orderId);
    if (order) return order;
  }

  const names = [...new Set(orderNameCandidates(orderName))];
  for (const name of names) {
    const order = await getOrderTagSummaryByName(admin, name);
    if (order) return order;
  }

  return null;
}

async function getOrderTagsById(admin, orderId) {
  const json = await adminGraphqlJson(
    admin,
    "mystery-box-entry-token-order-tags",
    `#graphql
      query OrderTags($id: ID!) {
        order(id: $id) {
          id
          name
          tags
          currentTotalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
        }
      }`,
    { variables: { id: orderId } },
  );

  return normalizeOrderTagSummary(json.data?.order);
}

async function getOrderTagSummaryById(admin, orderId) {
  const json = await adminGraphqlJson(
    admin,
    "mystery-box-entry-order-tags-by-id",
    `#graphql
      query MysteryBoxEntryOrderTagsById($id: ID!) {
        order(id: $id) {
          id
          name
          tags
          currentTotalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
        }
      }`,
    { variables: { id: orderId } },
  );

  return normalizeOrderTagSummary(json.data?.order);
}

async function getOrderTagSummaryByName(admin, orderName) {
  const json = await adminGraphqlJson(
    admin,
    "mystery-box-entry-order-tags-by-name",
    `#graphql
      query MysteryBoxEntryOrderTagsByName($query: String!) {
        orders(first: 1, query: $query) {
          nodes {
            id
            name
            tags
            currentTotalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
          }
        }
      }`,
    { variables: { query: `name:${orderName}` } },
  );

  return normalizeOrderTagSummary(json.data?.orders?.nodes?.[0]);
}

function normalizeOrderTagSummary(order) {
  if (!order) return null;
  return {
    id: order.id,
    name: order.name,
    tags: order.tags || [],
    total: Number(order.currentTotalPriceSet?.shopMoney?.amount || 0),
    currencyCode: order.currentTotalPriceSet?.shopMoney?.currencyCode || "",
  };
}

async function getOrderCustomerContactInfo(admin, orderId) {
  if (!orderId) return { name: "", contactInfo: "" };
  try {
    const json = await adminGraphqlJson(
      admin,
      "mystery-box-order-contact",
      `#graphql
        query MysteryBoxOrderContact($id: ID!) {
          order(id: $id) {
            email
            phone
            customer {
              displayName
              defaultEmailAddress {
                emailAddress
              }
              defaultPhoneNumber {
                phoneNumber
              }
            }
          }
        }`,
      { variables: { id: orderId } },
    );
    const order = json.data?.order;
    console.log("=====1 order", JSON.stringify(order, null, 2));
    console.log("=====2 customer", JSON.stringify(order?.customer || null, null, 2));
    return {
      name: order?.customer?.displayName || "",
      contactInfo: [
        order?.customer?.defaultEmailAddress?.emailAddress,
        order?.customer?.defaultPhoneNumber?.phoneNumber,
      ]
        .filter(Boolean)
        .join(" / "),
    };
  } catch (error) {
    console.error("[mystery-box-order-customer-contact]", error);
    return { name: "", contactInfo: "" };
  }
}

async function getShopDisplayDomain(admin, fallbackShop) {
  try {
    const response = await admin.graphql(
      `#graphql
        query MysteryBoxShopDomain {
          shop {
            myshopifyDomain
            primaryDomain {
              host
              url
            }
          }
        }`,
    );
    const json = await response.json();
    logGraphqlErrors("mystery-box-shop-domain", json);
    const shop = json.data?.shop;
    return (
      shop?.primaryDomain?.host ||
      normalizeDomainHost(shop?.primaryDomain?.url) ||
      shop?.myshopifyDomain ||
      fallbackShop
    );
  } catch (error) {
    console.error("[mystery-box-shop-domain]", error);
    return fallbackShop;
  }
}

async function addPrizeVariantToOrder(admin, order, draw) {
  if (draw.prizeType !== "prize" || !draw.prizeSku) return false;

  try {
    const variantAdded = await addVariantPrizeLineToOrder(admin, order, draw);
    const customAdded = variantAdded
      ? false
      : await addCustomPrizeLineToOrder(admin, order, draw);

    await addOrderTags(admin, order.id, ["8月盲盒活动中奖"]);
    return variantAdded || customAdded;
  } catch (error) {
    console.error("[mystery-box-add-prize-line]", error);
    return false;
  }
}

async function addVariantPrizeLineToOrder(admin, order, draw) {
  try {
    const variantId = await findVariantIdBySku(admin, draw.prizeSku);
    if (!variantId) {
      console.error("[mystery-box-prize-variant]", `Variant not found for SKU ${draw.prizeSku}`);
      return false;
    }

    const calculatedOrderId = await beginOrderEdit(admin, order.id);
    if (!calculatedOrderId) return false;

    const calculatedLineItemId = await addVariantToCalculatedOrder(
      admin,
      calculatedOrderId,
      variantId,
    );
    if (!calculatedLineItemId) return false;

    const discountAdded = await addPrizeLineDiscount(
      admin,
      calculatedOrderId,
      calculatedLineItemId,
    );
    if (!discountAdded) return false;

    return commitOrderEdit(admin, calculatedOrderId, draw);
  } catch (error) {
    console.error("[mystery-box-add-variant-prize-line]", error);
    return false;
  }
}

async function addCustomPrizeLineToOrder(admin, order, draw) {
  try {
    const calculatedOrderId = await beginOrderEdit(admin, order.id);
    if (!calculatedOrderId) return false;

    const added = await addCustomItemToCalculatedOrder(
      admin,
      calculatedOrderId,
      draw,
      order.currencyCode,
    );
    if (!added) return false;

    return commitOrderEdit(admin, calculatedOrderId, draw);
  } catch (error) {
    console.error("[mystery-box-add-custom-prize-line]", error);
    return false;
  }
}

async function findVariantIdBySku(admin, sku) {
  const json = await adminGraphqlJson(
    admin,
    "mystery-box-prize-variant",
    `#graphql
      query MysteryBoxPrizeVariant($query: String!) {
        productVariants(first: 1, query: $query) {
          nodes {
            id
            sku
          }
        }
      }`,
    { variables: { query: `sku:${escapeSearchValue(sku)}` } },
  );
  return json.data?.productVariants?.nodes?.[0]?.id || "";
}

async function beginOrderEdit(admin, orderId) {
  const json = await adminGraphqlJson(
    admin,
    "mystery-box-order-edit-begin",
    `#graphql
      mutation MysteryBoxOrderEditBegin($id: ID!) {
        orderEditBegin(id: $id) {
          calculatedOrder {
            id
          }
          userErrors {
            field
            message
          }
        }
      }`,
    { variables: { id: orderId } },
  );
  logUserErrors("mystery-box-order-edit-begin", json.data?.orderEditBegin?.userErrors);
  return json.data?.orderEditBegin?.calculatedOrder?.id || "";
}

async function addVariantToCalculatedOrder(admin, calculatedOrderId, variantId) {
  const json = await adminGraphqlJson(
    admin,
    "mystery-box-order-edit-add-variant",
    `#graphql
      mutation MysteryBoxOrderEditAddVariant($id: ID!, $variantId: ID!) {
        orderEditAddVariant(
          id: $id
          variantId: $variantId
          quantity: 1
          allowDuplicates: true
        ) {
          calculatedLineItem {
            id
          }
          userErrors {
            field
            message
          }
        }
      }`,
    { variables: { id: calculatedOrderId, variantId } },
  );
  logUserErrors(
    "mystery-box-order-edit-add-variant",
    json.data?.orderEditAddVariant?.userErrors,
  );
  return json.data?.orderEditAddVariant?.calculatedLineItem?.id || "";
}

async function addPrizeLineDiscount(admin, calculatedOrderId, calculatedLineItemId) {
  const json = await adminGraphqlJson(
    admin,
    "mystery-box-order-edit-line-discount",
    `#graphql
      mutation MysteryBoxOrderEditAddLineDiscount($id: ID!, $lineItemId: ID!) {
        orderEditAddLineItemDiscount(
          id: $id
          lineItemId: $lineItemId
          discount: {
            percentValue: 100
            description: "Lucky Box Opened"
          }
        ) {
          calculatedLineItem {
            id
          }
          userErrors {
            field
            message
          }
        }
      }`,
    { variables: { id: calculatedOrderId, lineItemId: calculatedLineItemId } },
  );
  logUserErrors(
    "mystery-box-order-edit-line-discount",
    json.data?.orderEditAddLineItemDiscount?.userErrors,
  );
  return Boolean(json.data?.orderEditAddLineItemDiscount?.calculatedLineItem?.id);
}

async function addCustomItemToCalculatedOrder(admin, calculatedOrderId, draw, currencyCode) {
  const json = await adminGraphqlJson(
    admin,
    "mystery-box-order-edit-add-custom-item",
    `#graphql
      mutation MysteryBoxOrderEditAddCustomItem(
        $id: ID!
        $title: String!
        $price: MoneyInput!
      ) {
        orderEditAddCustomItem(
          id: $id
          title: $title
          price: $price
          quantity: 1
          taxable: false
        ) {
          calculatedLineItem {
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
        id: calculatedOrderId,
        title: `Lucky Box Opened - ${draw.prizeTitle || draw.prizeSku}`,
        price: {
          amount: "0.00",
          currencyCode: currencyCode || "USD",
        },
      },
    },
  );
  logUserErrors(
    "mystery-box-order-edit-add-custom-item",
    json.data?.orderEditAddCustomItem?.userErrors,
  );
  return Boolean(json.data?.orderEditAddCustomItem?.calculatedLineItem?.id);
}

async function commitOrderEdit(admin, calculatedOrderId, draw) {
  const json = await adminGraphqlJson(
    admin,
    "mystery-box-order-edit-commit",
    `#graphql
      mutation MysteryBoxOrderEditCommit($id: ID!, $staffNote: String!) {
        orderEditCommit(id: $id, notifyCustomer: false, staffNote: $staffNote) {
          order {
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
        id: calculatedOrderId,
        staffNote: `PGY Lucky Box prize added: ${draw.prizeSku}`,
      },
    },
  );
  logUserErrors("mystery-box-order-edit-commit", json.data?.orderEditCommit?.userErrors);
  return Boolean(json.data?.orderEditCommit?.order?.id);
}

async function addOrderTags(admin, orderId, tags) {
  const json = await adminGraphqlJson(
    admin,
    "mystery-box-order-tags-add",
    `#graphql
      mutation MysteryBoxOrderTagsAdd($id: ID!, $tags: [String!]!) {
        tagsAdd(id: $id, tags: $tags) {
          node {
            id
          }
          userErrors {
            field
            message
          }
        }
      }`,
    { variables: { id: orderId, tags } },
  );
  logUserErrors("mystery-box-order-tags-add", json.data?.tagsAdd?.userErrors);
}

async function notifyFeishu(webhookUrl, payload) {
  if (!webhookUrl) return;
  const { shopDomain, order, region, draw, autoAddedToOrder } = payload;
  const resultText =
    draw.prizeType === "prize"
      ? `中奖：${draw.prizeSku}${draw.prizeTitle ? ` (${draw.prizeTitle})` : ""}`
      : "未中奖";
  const shopUrl = domainToUrl(shopDomain);
  const contactInfo = order.contactInfo || "N/A";
  const customerName = order.customerName || "N/A";

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        msg_type: "interactive",
        card: {
          config: {
            wide_screen_mode: true,
          },
          header: {
            template: draw.prizeType === "prize" ? "green" : "grey",
            title: {
              tag: "plain_text",
              content: "PGY盲盒抽奖通知",
            },
          },
          elements: [
            {
              tag: "div",
              text: {
                tag: "lark_md",
                content: [
                  `**店铺：**[${escapeFeishuMarkdown(shopDomain)}](${shopUrl})`,
                  `**订单：**${escapeFeishuMarkdown(order.name)}`,
                  `**客户：**${escapeFeishuMarkdown(customerName)}`,
                  `**联系信息：**${escapeFeishuMarkdown(contactInfo)}`,
                  `**地区规则：**${region === "US" ? "美区" : "美区外"}`,
                  `**订单金额：**${escapeFeishuMarkdown(`${order.total} ${order.currencyCode}`)}`,
                  `**结果：**${escapeFeishuMarkdown(resultText)}`,
                  `**是否自动添加到订单：**${autoAddedToOrder ? "是" : "否"}`,
                ].join("\n"),
              },
            },
          ],
        },
      }),
    });
  } catch (error) {
    console.error("[mystery-box-feishu]", error);
  }
}

function normalizeDomainHost(value) {
  if (!value) return "";
  try {
    return new URL(value).host;
  } catch {
    return String(value).replace(/^https?:\/\//, "").split("/")[0];
  }
}

function domainToUrl(domain) {
  const normalized = String(domain || "").trim();
  if (!normalized) return "";
  if (/^https?:\/\//.test(normalized)) return normalized;
  return `https://${normalized}`;
}

function escapeFeishuMarkdown(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function logGraphqlErrors(label, json) {
  const errors = json?.errors?.graphQLErrors || json?.errors;
  if (errors) {
    console.error(`[${label}]`, JSON.stringify(errors, null, 2));
  }
}

function logUserErrors(label, userErrors = []) {
  if (userErrors?.length) {
    console.error(`[${label}]`, JSON.stringify(userErrors, null, 2));
  }
}

async function adminGraphqlJson(admin, label, query, options) {
  try {
    const response = await admin.graphql(query, options);
    const json = await response.json();
    logGraphqlErrors(label, json);
    return json;
  } catch (error) {
    console.error(`[${label}]`, JSON.stringify(extractGraphqlError(error), null, 2));
    return { data: null, errors: extractGraphqlError(error) };
  }
}

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

async function enrichMissingRuleImages(admin, rules) {
  if (rules.prizes.every((prize) => !prize.sku || prize.imageUrl)) return rules;
  return enrichRulesWithVariantData(admin, rules);
}

async function enrichRulesWithVariantData(admin, rules) {
  const skus = rules.prizes.map((prize) => prize.sku).filter(Boolean);
  if (skus.length === 0) return rules;

  const skuQuery = skus.map((sku) => `sku:${escapeSearchValue(sku)}`).join(" OR ");
  const json = await adminGraphqlJson(
    admin,
    "mystery-box-sku-lookup",
    `#graphql
      query MysteryBoxSkuLookup($query: String!) {
        productVariants(first: 50, query: $query) {
          nodes {
            sku
            displayName
            image {
              url(transform: { maxWidth: 360, maxHeight: 360 })
              altText
            }
            product {
              featuredImage {
                url(transform: { maxWidth: 360, maxHeight: 360 })
                altText
              }
              featuredMedia {
                preview {
                  image {
                    url(transform: { maxWidth: 360, maxHeight: 360 })
                    altText
                  }
                }
              }
              media(first: 1) {
                nodes {
                  preview {
                    image {
                      url(transform: { maxWidth: 360, maxHeight: 360 })
                      altText
                    }
                  }
                }
              }
            }
          }
        }
      }`,
    { variables: { query: skuQuery } },
  );
  const variants = json.data?.productVariants?.nodes || [];
  const dataBySku = new Map(
    variants.map((variant) => {
      const image =
        variant.image ||
        variant.product?.featuredImage ||
        variant.product?.featuredMedia?.preview?.image ||
        variant.product?.media?.nodes?.[0]?.preview?.image ||
        null;
      return [
        String(variant.sku || "").toUpperCase(),
        {
          title: variant.displayName,
          imageUrl: image?.url || "",
          imageAlt: image?.altText || variant.displayName || "",
        },
      ];
    }),
  );

  for (const sku of skus) {
    const data = dataBySku.get(sku.toUpperCase());
    if (!data?.imageUrl) {
      console.warn("[mystery-box-sku-image-missing]", {
        sku,
        foundVariant: Boolean(data),
      });
    }
  }

  return {
    ...rules,
    prizes: rules.prizes.map((prize) => {
      const data = dataBySku.get(prize.sku.toUpperCase());
      return {
        ...prize,
        title: data?.title || prize.title || "",
        imageUrl: data?.imageUrl || prize.imageUrl || "",
        imageAlt: data?.imageAlt || prize.imageAlt || "",
      };
    }),
  };
}

function normalizeRulesFromForm(formData, prefix) {
  const prizes = [0, 1, 2].map((index) => ({
    sku: String(formData.get(`${prefix}Sku${index}`) || "").trim(),
    title: "",
    imageUrl: "",
    imageAlt: "",
    probability: Number(formData.get(`${prefix}Probability${index}`) || 0),
  }));
  return normalizeRules({
    prizes,
    noPrizeProbability: Number(formData.get(`${prefix}NoPrizeProbability`) || 0),
  });
}

function normalizeRules(rawRules) {
  const source = rawRules && typeof rawRules === "object" ? rawRules : DEFAULT_RULES;
  const prizes = Array.isArray(source.prizes) ? source.prizes : [];
  return {
    prizes: [0, 1, 2].map((index) => {
      const prize = prizes[index] || {};
      return {
        sku: String(prize.sku || "").trim(),
        title: String(prize.title || "").trim(),
        imageUrl: String(prize.imageUrl || "").trim(),
        imageAlt: String(prize.imageAlt || "").trim(),
        probability: Math.max(0, Number(prize.probability || 0)),
      };
    }),
    noPrizeProbability: Math.max(0, Number(source.noPrizeProbability || 0)),
  };
}

function validateRules(rules, label) {
  const missingSku = rules.prizes.find(
    (prize) => prize.probability > 0 && !prize.sku,
  );
  if (missingSku) {
    return `${label}: prizes with a probability greater than 0 must have a SKU.`;
  }

  const total =
    rules.noPrizeProbability +
    rules.prizes.reduce((sum, prize) => sum + prize.probability, 0);
  if (total <= 0) return `${label}: total probability must be greater than 0.`;
  if (Math.abs(total - 100) > 0.001) {
    return `${label}: the three SKU probabilities plus the no-prize probability must equal 100.`;
  }
  return null;
}

function pickPrize(rules) {
  const candidates = [
    ...rules.prizes.map((prize) => ({ type: "prize", ...prize })),
    {
      type: "none",
      sku: "",
      title: "",
      probability: rules.noPrizeProbability,
    },
  ].filter((candidate) => candidate.probability > 0);
  const total = candidates.reduce(
    (sum, candidate) => sum + candidate.probability,
    0,
  );
  let roll = Math.random() * total;
  for (const candidate of candidates) {
    roll -= candidate.probability;
    if (roll <= 0) return candidate;
  }
  return candidates[candidates.length - 1];
}

function serializeDraw(draw) {
  return {
    id: draw.id,
    region: draw.region,
    prizeType: draw.prizeType,
    prizeSku: draw.prizeSku,
    prizeTitle: draw.prizeTitle,
    orderName: draw.orderName,
    createdAt: draw.createdAt,
  };
}

function dateInputValue(date) {
  const beijingTime = new Date(
    new Date(date).getTime() + BEIJING_OFFSET_MINUTES * 60 * 1000,
  );
  return beijingTime.toISOString().slice(0, 10);
}

function parseBeijingDateInput(value) {
  const [year, month, day] = String(value).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, -8, 0, 0, 0));
}

function escapeSearchValue(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function hasMysteryBoxModels() {
  return Boolean(prisma.mysteryBoxSetting && prisma.mysteryBoxDraw);
}

function isMissingMysteryBoxTableError(error) {
  return (
    error?.code === "P2021" ||
    error?.code === "P2022" ||
    String(error?.message || "").includes("MysteryBox")
  );
}
