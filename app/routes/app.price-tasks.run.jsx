import { authenticate } from "../shopify.server";
import { runDuePriceTasks } from "../lib/price-tasks.server";

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const result = await runDuePriceTasks(admin, session.shop);

  return Response.json({ ok: true, ...result });
};

export const loader = async () => {
  throw new Response("Method Not Allowed", { status: 405 });
};
