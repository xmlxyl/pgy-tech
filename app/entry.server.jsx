import { handleRequest as vercelHandleRequest } from "@vercel/react-router/entry.server";
import {
  handleEmailProxyRequest,
  isEmailProxyPath,
} from "./lib/email-proxy.server";
import { addDocumentResponseHeaders } from "./shopify.server";

export { streamTimeout } from "@vercel/react-router/entry.server";

const MYSTERY_BOX_ENTRY_PATHS = new Set([
  "/api/mystery-box-entry",
  "/apps/pgy-tech/mystery-box-entry",
]);

const MYSTERY_BOX_ENTRY_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Shopify-Access-Token",
  "Access-Control-Max-Age": "86400",
};

export default async function handleRequest(
  request,
  responseStatusCode,
  responseHeaders,
  reactRouterContext,
  loadContext,
) {
  const { pathname } = new URL(request.url);
  if (MYSTERY_BOX_ENTRY_PATHS.has(pathname) && request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: MYSTERY_BOX_ENTRY_CORS_HEADERS,
    });
  }

  if (isEmailProxyPath(pathname)) {
    return handleEmailProxyRequest(request);
  }

  addDocumentResponseHeaders(request, responseHeaders);
  return vercelHandleRequest(
    request,
    responseStatusCode,
    responseHeaders,
    reactRouterContext,
    loadContext,
  );
}
