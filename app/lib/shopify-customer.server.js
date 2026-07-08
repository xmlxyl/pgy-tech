/**
 * @param {import("@shopify/shopify-app-react-router/server").AdminApiContext["graphql"]} adminGraphql
 * @param {string} email
 */
export async function subscribeCustomerEmail(adminGraphql, email) {
  const searchResponse = await adminGraphql(
    `#graphql
      query FindCustomerByEmail($query: String!) {
        customers(first: 1, query: $query) {
          nodes {
            id
            email
          }
        }
      }`,
    { variables: { query: `email:${email}` } },
  );
  const searchJson = await searchResponse.json();
  const existing = searchJson.data?.customers?.nodes?.[0];

  const consent = {
    marketingState: "SUBSCRIBED",
    marketingOptInLevel: "SINGLE_OPT_IN",
    consentUpdatedAt: new Date().toISOString(),
  };

  if (existing?.id) {
    const updateResponse = await adminGraphql(
      `#graphql
        mutation UpdateCustomerConsent($input: CustomerEmailMarketingConsentUpdateInput!) {
          customerEmailMarketingConsentUpdate(input: $input) {
            customer {
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
          input: {
            customerId: existing.id,
            emailMarketingConsent: consent,
          },
        },
      },
    );
    const updateJson = await updateResponse.json();
    const errors = updateJson.data?.customerEmailMarketingConsentUpdate?.userErrors ?? [];
    if (errors.length > 0) {
      throw new Error(errors.map((e) => e.message).join("; "));
    }
    return existing.id;
  }

  const createResponse = await adminGraphql(
    `#graphql
      mutation CreateSubscribedCustomer($input: CustomerInput!) {
        customerCreate(input: $input) {
          customer {
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
        input: {
          email,
          emailMarketingConsent: consent,
        },
      },
    },
  );
  const createJson = await createResponse.json();
  const errors = createJson.data?.customerCreate?.userErrors ?? [];
  if (errors.length > 0) {
    throw new Error(errors.map((e) => e.message).join("; "));
  }
  return createJson.data?.customerCreate?.customer?.id;
}
