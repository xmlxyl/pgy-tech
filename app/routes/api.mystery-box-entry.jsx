import { getMysteryBoxEntryDrawStatus } from "../lib/mystery-box.server";
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
    return corsResponse(new Response(null, { status: 204 }));
  }

  return corsJson(
    { ok: false, show: false, message: "Method not allowed." },
    { status: 405 },
  );
};

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return corsResponse(new Response(null, { status: 204 }));
  }

  try {
    const auth = await authenticateEntryRequest(request);
    const data = await getMysteryBoxEntryDrawStatus(request, auth.sessionToken);
    return corsJson(data);
  } catch (error) {
    console.error("[mystery-box-entry-api]", error);

    if (error instanceof Response) {
      return corsJson(
        { ok: false, show: false, message: "Lucky box entry is unavailable." },
        { status: error.status || 401 },
      );
    }

    return corsJson(
      { ok: false, show: false, message: "Lucky box entry is unavailable." },
      { status: 200 },
    );
  }
};

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

function corsJson(data, init = {}) {
  const headers = new Headers(init.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    headers.set(key, value);
  }

  return Response.json(data, { ...init, headers });
}

function corsResponse(response) {
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    response.headers.set(key, value);
  }

  return response;
}
