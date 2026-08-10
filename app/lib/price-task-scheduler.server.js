/* eslint-disable no-undef */
import { unauthenticated } from "../shopify.server";
import { runDuePriceTasksForAllShops } from "./price-tasks.server";

const SCHEDULER_INTERVAL_MS = 30 * 1000;

export function startPriceTaskScheduler() {
  if (!shouldStartInlineScheduler()) return;

  if (global.priceTaskSchedulerStarted) return;
  global.priceTaskSchedulerStarted = true;

  const run = async () => {
    if (global.priceTaskSchedulerRunning) return;
    global.priceTaskSchedulerRunning = true;

    try {
      const results = await runDuePriceTasksForAllShops(async (shop) => {
        const { admin } = await unauthenticated.admin(shop);
        return admin;
      });
      const touched = results.filter(
        (result) =>
          result.changed?.length ||
          result.restored?.length ||
          result.expired?.length ||
          !result.ok,
      );

      if (touched.length) {
        console.log("[price-task-scheduler]", JSON.stringify(touched));
      }
    } catch (error) {
      console.error("[price-task-scheduler]", error);
    } finally {
      global.priceTaskSchedulerRunning = false;
    }
  };

  setTimeout(run, 1000);
  global.priceTaskSchedulerTimer = setInterval(run, SCHEDULER_INTERVAL_MS);
}

function shouldStartInlineScheduler() {
  if (process.env.PRICE_TASK_INLINE_SCHEDULER === "true") return true;
  return process.env.NODE_ENV !== "production" && !process.env.VERCEL;
}
