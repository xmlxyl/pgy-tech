/**
 * @param {import("@shopify/shopify-app-react-router/server").AdminApiContext["graphql"]} adminGraphql
 * @param {{ code: string, title: string, percentage: number }} options
 */
export async function createCouponDiscount(adminGraphql, { code, title, percentage }) {
  const startsAt = new Date().toISOString();
  const endsAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

  const response = await adminGraphql(
    `#graphql
      mutation LotteryDiscountCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
        discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
          codeDiscountNode {
            id
          }
          userErrors {
            field
            message
          }
        }
      }`,
    {
      variables: {
        basicCodeDiscount: {
          title,
          code,
          startsAt,
          endsAt,
          customerSelection: { all: true },
          customerGets: {
            value: { percentage },
            items: { all: true },
          },
          appliesOncePerCustomer: true,
          usageLimit: 1,
        },
      },
    },
  );

  const json = await response.json();
  const errors = json.data?.discountCodeBasicCreate?.userErrors ?? [];
  if (errors.length > 0) {
    throw new Error(errors.map((e) => e.message).join("; "));
  }
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }

  return json.data?.discountCodeBasicCreate?.codeDiscountNode;
}
