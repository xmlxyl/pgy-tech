import {
  getMysteryBoxEntryConfig,
  getMysteryBoxEntryDrawStatus,
  getMysteryBoxEntryStatus,
} from "../lib/mystery-box.server";
import { authenticate } from "../shopify.server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Shopify-Access-Token",
  "Access-Control-Max-Age": "86400",
};

export const action = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  return Response.json(
    { ok: false, show: false, message: "Method not allowed." },
    { status: 405, headers: CORS_HEADERS },
  );
};

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  try {
    const url = new URL(request.url);
    if (url.searchParams.get("mode") === "config") {
      const data = await getMysteryBoxEntryConfig(request);
      return Response.json(data, { headers: CORS_HEADERS });
    }

    const data = request.headers.get("authorization")
      ? await getMysteryBoxEntryTokenStatus(request)
      : await getMysteryBoxEntryStatus(request);

    return Response.json(data, { headers: CORS_HEADERS });
  } catch (error) {
    console.error("[mystery-box-entry]", error);
    return Response.json(
      { ok: false, show: false, message: "Lucky box entry is unavailable." },
      { headers: CORS_HEADERS },
    );
  }
};

async function getMysteryBoxEntryTokenStatus(request) {
  const auth = await authenticateEntryRequest(request);
  return getMysteryBoxEntryDrawStatus(request, auth.sessionToken);
}

async function authenticateEntryRequest(request) {
  const options = {
    corsHeaders: ["Content-Type", "Authorization", "X-Shopify-Access-Token"],
  };

  try {
    return await authenticate.public.customerAccount(request, options);
  } catch (customerAccountError) {
    try {
      return await authenticate.public.checkout(request, options);
    } catch (checkoutError) {
      throw checkoutError instanceof Response
        ? checkoutError
        : customerAccountError;
    }
  }
}
