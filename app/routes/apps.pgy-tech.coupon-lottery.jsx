import { handleCouponLotteryProxyRequest } from "../lib/coupon-lottery.server";

/** @param {{ request: Request }} args */
export const loader = async ({ request }) =>
  handleCouponLotteryProxyRequest(request);

/** @param {{ request: Request }} args */
export const action = async ({ request }) =>
  handleCouponLotteryProxyRequest(request);
