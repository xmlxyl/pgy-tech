import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

const FUNCTION_HANDLE = "free-gift-discount";
const FUNCTION_TITLE = "Free Gift Discount";
const DISCOUNT_TITLE = "PGY Free Gift";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const functionNode = await findFreeGiftFunction(admin);

  return {
    functionHandle: FUNCTION_HANDLE,
    functionId: functionNode?.id || null,
    functionTitle: functionNode?.title || FUNCTION_TITLE,
  };
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const functionNode = await findFreeGiftFunction(admin);

  if (!functionNode) {
    return {
      ok: false,
      message: "Free gift discount function was not found. Deploy the app first.",
    };
  }

  const response = await admin.graphql(
    `#graphql
      mutation CreateFreeGiftAutomaticDiscount($discount: DiscountAutomaticAppInput!) {
        discountAutomaticAppCreate(automaticAppDiscount: $discount) {
          automaticAppDiscount {
            discountId
            title
            status
          }
          userErrors {
            field
            message
          }
        }
      }`,
    {
      variables: {
        discount: {
          title: DISCOUNT_TITLE,
          functionId: functionNode.id,
          startsAt: new Date().toISOString(),
          combinesWith: {
            orderDiscounts: true,
            productDiscounts: true,
            shippingDiscounts: true,
          },
        },
      },
    },
  );

  const json = await response.json();
  const result = json.data?.discountAutomaticAppCreate;
  const error = json.errors?.[0]?.message || result?.userErrors?.[0]?.message;

  if (error) {
    return { ok: false, message: error };
  }

  return {
    ok: true,
    message: `${result.automaticAppDiscount.title} discount is enabled.`,
    discountId: result.automaticAppDiscount.discountId,
    status: result.automaticAppDiscount.status,
  };
};

export default function FreeGiftPage() {
  const data = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <s-page heading="Free Gift Discount" inlineSize="base">
      <s-section heading="Automatic app discount">
        {actionData ? (
          <s-banner tone={actionData.ok ? "success" : "critical"}>
            {actionData.message}
          </s-banner>
        ) : null}

        <s-paragraph>
          Create an automatic Shopify discount that uses the free gift Product
          Discount Function.
        </s-paragraph>

        <s-stack gap="small">
          <s-text>Function handle: {data.functionHandle}</s-text>
          <s-text>
            Function status: {data.functionId ? "Available" : "Not deployed"}
          </s-text>
        </s-stack>

        <Form method="post">
          <s-box paddingBlockStart="base">
            <s-button
              type="submit"
              variant="primary"
              disabled={!data.functionId || isSubmitting}
            >
              {isSubmitting ? "Creating..." : "Enable free gift discount"}
            </s-button>
          </s-box>
        </Form>
      </s-section>
    </s-page>
  );
}

async function findFreeGiftFunction(admin) {
  const response = await admin.graphql(
    `#graphql
      query FreeGiftFunction {
        shopifyFunctions(first: 50) {
          nodes {
            id
            title
          }
        }
      }`,
  );

  const json = await response.json();
  const functions = json.data?.shopifyFunctions?.nodes || [];

  return (
    functions.find((node) => node.title === FUNCTION_TITLE) || null
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
