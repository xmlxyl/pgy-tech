import { handleRequest as vercelHandleRequest } from "@vercel/react-router/entry.server";
import {
  handleEmailProxyRequest,
  isEmailProxyPath,
} from "./lib/email-proxy.server";
import { startPriceTaskScheduler } from "./lib/price-task-scheduler.server";
import { addDocumentResponseHeaders } from "./shopify.server";

export { streamTimeout } from "@vercel/react-router/entry.server";

startPriceTaskScheduler();

export default async function handleRequest(
  request,
  responseStatusCode,
  responseHeaders,
  reactRouterContext,
  loadContext,
) {
  const { pathname } = new URL(request.url);
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
