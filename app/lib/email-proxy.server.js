import { authenticate } from "../shopify.server";
import { saveEmailForShop, validateEmail } from "./saved-email.server";

export const EMAIL_PROXY_PATH = "/apps/pgy-tech/email";

/** @param {Request} request */
function shopFromRequest(request) {
  return new URL(request.url).searchParams.get("shop");
}

/**
 * App Proxy HMAC 通过后，若离线 token 刷新失败，Shopify SDK 可能抛出非 Response 错误。
 * 邮箱收集只需要可信的 shop，因此在 HMAC 已通过的前提下回退到 query 中的 shop。
 * @param {Request} request
 */
async function authenticateProxy(request) {
  try {
    const context = await authenticate.public.appProxy(request);
    return { ok: true, context };
  } catch (error) {
    const shop = shopFromRequest(request);
    const hasSignature = new URL(request.url).searchParams.has("signature");

    // HMAC 校验失败：SDK 抛出 Response 400
    if (error instanceof Response && error.status === 400) {
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

    // HMAC 已通过，但 session / token refresh 失败：回退到签名请求里的 shop
    if (shop && hasSignature) {
      console.error("[email-proxy] auth session failed, fallback to shop param", {
        shop,
        status: error instanceof Response ? error.status : undefined,
        message: error instanceof Error ? error.message : String(error),
      });
      return { ok: true, context: { session: { shop } } };
    }

    console.error("[email-proxy] auth failed", error);
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
}

/** @param {Request} request */
async function resolveShop(request) {
  const auth = await authenticateProxy(request);
  if (!auth.ok) return auth;

  const shop = auth.context.session?.shop ?? shopFromRequest(request);
  if (!shop) {
    return {
      ok: false,
      response: Response.json(
        { ok: false, error: "无法识别店铺" },
        { status: 400 },
      ),
    };
  }
  return { ok: true, shop };
}

/** @param {string} shop @param {unknown} emailRaw @param {unknown} usernameRaw @param {unknown} typeRaw */
async function handleSubscribe(shop, emailRaw, usernameRaw, typeRaw) {
  const validation = validateEmail(emailRaw);
  if (!validation.ok) {
    return Response.json(
      { ok: false, error: validation.error },
      { status: 400 },
    );
  }

  try {
    const result = await saveEmailForShop(
      shop,
      validation.email,
      usernameRaw,
      typeRaw,
    );
    return Response.json({
      ok: true,
      error: null,
      alreadySubscribed: result.alreadySubscribed,
    });
  } catch (error) {
    console.error("[email-proxy] save failed", { shop, error });
    return Response.json(
      { ok: false, error: "保存失败，请稍后再试" },
      { status: 500 },
    );
  }
}

/** @param {Request} request */
export async function handleEmailProxyRequest(request) {
  try {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    if (method === "GET") {
      const emailParam = url.searchParams.get("email");
      if (!emailParam) {
        const auth = await authenticateProxy(request);
        if (!auth.ok) return auth.response;
        return Response.json({ ok: true, message: "PGY email collector proxy" });
      }
      const shopResult = await resolveShop(request);
      if (!shopResult.ok) return shopResult.response;
      const usernameParam = url.searchParams.get("username");
      const typeParam =
        url.searchParams.get("campaign_type") ||
        url.searchParams.get("type");
      return handleSubscribe(
        shopResult.shop,
        emailParam,
        usernameParam,
        typeParam,
      );
    }

    if (method === "POST") {
      const shopResult = await resolveShop(request);
      if (!shopResult.ok) return shopResult.response;

      let emailRaw;
      let usernameRaw;
      let typeRaw;
      const contentType = request.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const body = await request.json();
        emailRaw = body?.email;
        usernameRaw = body?.username;
        typeRaw = body?.campaign_type ?? body?.type;
      } else {
        const formData = await request.formData();
        emailRaw = formData.get("email");
        usernameRaw = formData.get("username");
        typeRaw = formData.get("campaign_type") || formData.get("type");
      }
      return handleSubscribe(shopResult.shop, emailRaw, usernameRaw, typeRaw);
    }

    return Response.json(
      { ok: false, error: "Method not allowed" },
      { status: 405 },
    );
  } catch (error) {
    console.error("[email-proxy] unhandled", error);
    return Response.json(
      { ok: false, error: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }
}

/** @param {string} pathname */
export function isEmailProxyPath(pathname) {
  return pathname === EMAIL_PROXY_PATH || pathname === `${EMAIL_PROXY_PATH}/`;
}
