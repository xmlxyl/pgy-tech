import { authenticate } from "../shopify.server";
import { saveEmailForShop, validateEmail } from "./saved-email.server";

export const EMAIL_PROXY_PATH = "/apps/pgy-tech/email";

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
async function resolveShop(request) {
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
  return { ok: true, shop };
}

/** @param {string} shop @param {unknown} emailRaw */
async function handleSubscribe(shop, emailRaw) {
  const validation = validateEmail(emailRaw);
  if (!validation.ok) {
    return Response.json(
      { ok: false, error: validation.error },
      { status: 400 },
    );
  }

  try {
    await saveEmailForShop(shop, validation.email);
    return Response.json({ ok: true, error: null });
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
    return handleSubscribe(shopResult.shop, emailParam);
  }

  if (method === "POST") {
    const shopResult = await resolveShop(request);
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
    return handleSubscribe(shopResult.shop, emailRaw);
  }

  return Response.json({ ok: false, error: "Method not allowed" }, { status: 405 });
}

/** @param {string} pathname */
export function isEmailProxyPath(pathname) {
  return pathname === EMAIL_PROXY_PATH || pathname === `${EMAIL_PROXY_PATH}/`;
}
