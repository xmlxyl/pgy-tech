/* eslint-disable no-undef */
import { unauthenticated } from "../shopify.server";
import { runDuePriceTasksForAllShops } from "../lib/price-tasks.server";

export const loader = async ({ request }) => runCron(request);
export const action = async ({ request }) => runCron(request);

async function runCron(request) {
  const authHeader = request.headers.get("authorization") || "";
  const expectedSecret = process.env.CRON_SECRET;

  if (expectedSecret && authHeader !== `Bearer ${expectedSecret}`) {
    return Response.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }

  const startedAt = new Date();
  const results = await runDuePriceTasksForAllShops(async (shop) => {
    const { admin } = await unauthenticated.admin(shop);
    return admin;
  });

  return Response.json({
    ok: true,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    shops: results,
  });
}
