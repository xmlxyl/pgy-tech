import { handleLotteryProxyRequest } from "../lib/lottery-proxy.server";

/** @param {{ request: Request }} args */
export const loader = async ({ request }) => handleLotteryProxyRequest(request);

/** @param {{ request: Request }} args */
export const action = async ({ request }) => handleLotteryProxyRequest(request);
