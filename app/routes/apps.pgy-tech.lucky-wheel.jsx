import { handleLuckyWheelProxyRequest } from "../lib/lucky-wheel.server";

/** @param {{ request: Request }} args */
export const loader = async ({ request }) => handleLuckyWheelProxyRequest(request);

/** @param {{ request: Request }} args */
export const action = async ({ request }) => handleLuckyWheelProxyRequest(request);
