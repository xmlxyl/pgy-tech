import { Outlet } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

export default function PriceTasksLayout() {
  return <Outlet />;
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
