import { authenticate } from "../shopify.server";
import {
  getLotteryPrizesForShop,
  runLotteryDraw,
} from "./lottery.server";

export const LOTTERY_PROXY_PATH = "/apps/pgy-tech/lottery";

/** @param {Request} request */
async function authenticateProxy(request) {
  try {
    const context = await authenticate.public.appProxy(request);
    return { ok: true, context };
  } catch (error) {
    if (error instanceof Response) {
      return {
        ok: false,
        response: Response.json(
          {
            ok: false,
            error:
              "App Proxy 验证失败。请在店铺前台页面测试（非主题编辑器预览），并确认应用已安装。",
          },
          { status: 401 },
        ),
      };
    }
    throw error;
  }
}

/** @param {Request} request */
async function resolveShopAndAdmin(request) {
  const auth = await authenticateProxy(request);
  if (!auth.ok) return auth;

  const shop =
    auth.context.session?.shop ??
    new URL(request.url).searchParams.get("shop");
  if (!shop) {
    return {
      ok: false,
      response: Response.json(
        { ok: false, error: "无法识别店铺" },
        { status: 400 },
      ),
    };
  }

  return {
    ok: true,
    shop,
    adminGraphql: auth.context.admin?.graphql,
  };
}

/** @param {string} shop */
async function handleGetConfig(shop) {
  const prizes = await getLotteryPrizesForShop(shop);
  return Response.json({
    ok: true,
    prizes: prizes.map((p) => ({
      slot: p.slot,
      title: p.title,
      imageUrl: p.imageUrl,
      enabled: p.enabled,
    })),
  });
}

/** @param {Request} request */
export async function handleLotteryProxyRequest(request) {
  const method = request.method.toUpperCase();
  const url = new URL(request.url);

  if (method === "GET") {
    const shopResult = await resolveShopAndAdmin(request);
    if (!shopResult.ok) return shopResult.response;
    return handleGetConfig(shopResult.shop);
  }

  if (method === "POST") {
    const shopResult = await resolveShopAndAdmin(request);
    if (!shopResult.ok) return shopResult.response;

    let emailRaw;
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = await request.json();
      emailRaw = body?.email;
    } else {
      const formData = await request.formData();
      emailRaw = formData.get("email");
    }

    const result = await runLotteryDraw({
      shop: shopResult.shop,
      email: emailRaw,
      adminGraphql: shopResult.adminGraphql,
    });

    if (!result.ok) {
      return Response.json(
        {
          ok: false,
          error: result.error,
          ...(result.entry
            ? {
                prize: {
                  slot: result.entry.prizeSlot,
                  title: result.entry.prizeTitle,
                  couponCode: result.entry.couponCode,
                },
              }
            : {}),
        },
        { status: result.status ?? 400 },
      );
    }

    return Response.json({
      ok: true,
      prize: result.prize,
      emailSent: result.emailSent,
    });
  }

  return Response.json({ ok: false, error: "Method not allowed" }, { status: 405 });
}

/** @param {string} pathname */
export function isLotteryProxyPath(pathname) {
  return pathname === LOTTERY_PROXY_PATH || pathname === `${LOTTERY_PROXY_PATH}/`;
}
