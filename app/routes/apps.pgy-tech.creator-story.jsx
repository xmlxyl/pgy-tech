import { handleCreatorStoryProxyRequest } from "../lib/creator-story.server";

/** @param {{ request: Request }} args */
export const loader = async ({ request }) =>
  handleCreatorStoryProxyRequest(request);

/** @param {{ request: Request }} args */
export const action = async ({ request }) =>
  handleCreatorStoryProxyRequest(request);
