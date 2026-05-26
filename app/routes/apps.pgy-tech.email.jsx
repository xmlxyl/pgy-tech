import { handleEmailProxyRequest } from "../lib/email-proxy.server";

/** @param {{ request: Request }} args */
export const loader = async ({ request }) => handleEmailProxyRequest(request);

/** @param {{ request: Request }} args */
export const action = async ({ request }) => handleEmailProxyRequest(request);
