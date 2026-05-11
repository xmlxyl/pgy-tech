import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  FAQ_TITLE_KEY,
  FAQ_TITLE_KEY_CANDIDATES,
  getFaqGroupMetaobjectType,
  metaobjectNumericIdFromGid,
  pickMetaobjectFieldValue,
  summarizeReferencedByProducts,
} from "../lib/faq-metafields";

const PAGE_SIZE = 200;

/** @param {{ request: Request }} args */
export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const after = url.searchParams.get("after") || null;
  const type = getFaqGroupMetaobjectType();

  const response = await admin.graphql(
    `#graphql
      query FaqGroupList($type: String!, $first: Int!, $after: String) {
        metaobjects(type: $type, first: $first, after: $after) {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            node {
              id
              handle
              fields {
                key
                value
                jsonValue
              }
              referencedBy(first: 25) {
                pageInfo {
                  hasNextPage
                }
                edges {
                  node {
                    namespace
                    key
                    referencer {
                      __typename
                      ... on Product {
                        id
                        title
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }`,
    { variables: { type, first: PAGE_SIZE, after } },
  );

  const json = await response.json();
  const data = json.data?.metaobjects;
  if (!data) {
    return {
      rows: [],
      pageInfo: { hasNextPage: false, endCursor: null },
      hasPrevPage: Boolean(after),
      metaobjectType: type,
      error: json.errors?.[0]?.message ?? "加载 faq_group 列表失败",
    };
  }

  const rows = data.edges.map(({ node }) => ({
    id: node.id,
    faqTitleField: pickMetaobjectFieldValue(
      node.fields,
      FAQ_TITLE_KEY_CANDIDATES,
    ),
    referencedByLabel: summarizeReferencedByProducts(node.referencedBy),
  }));

  return {
    rows,
    pageInfo: data.pageInfo,
    hasPrevPage: Boolean(after),
    metaobjectType: type,
    error: null,
  };
};

export default function FaqManagementIndex() {
  const { rows, pageInfo, hasPrevPage, metaobjectType, error } = useLoaderData();

  return (
    <s-page heading="FAQ管理" inlineSize="large">
      <s-section>
        {error ? (
          <s-banner tone="critical">{error}</s-banner>
        ) : (
          <s-paragraph tone="subdued">
            {/* 列表来自 Metaobject 类型{" "}
            <code>{metaobjectType}</code>（环境变量{" "}
            <code>FAQ_GROUP_METAOBJECT_TYPE</code> 可覆盖）。第一列为字段{" "}
            <code>{FAQ_TITLE_KEY}</code>（及常见别名）在{" "}
            <code>fields</code> 中的值；第二列为 <code>referencedBy</code>{" "}
            中的引用方（商品标题需 <code>read_products</code> 授权）。 */}
          </s-paragraph>
        )}
        <s-table
          variant="table"
          loading={false}
          paginate={false}
          hasNextPage={false}
          hasPreviousPage={false}
        >
          <s-table-header-row>
            <s-table-header listSlot="primary" format="base">
              faq-title（字段值）
            </s-table-header>
            <s-table-header listSlot="labeled" format="base">
              引用产品（谁引用了该 FAQ）
            </s-table-header>
          </s-table-header-row>
          <s-table-body>
            {rows.map((row) => (
              <s-table-row key={row.id}>
                <s-table-cell>
                  <s-link
                    href={`/app/faq/${metaobjectNumericIdFromGid(row.id)}`}
                  >
                    {row.faqTitleField.trim() !== ""
                      ? row.faqTitleField
                      : "—"}
                  </s-link>
                </s-table-cell>
                <s-table-cell>{row.referencedByLabel}</s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
        {rows.length === 0 && !error ? (
          <s-paragraph>暂无 faq_group 条目。</s-paragraph>
        ) : null}
        <s-stack direction="inline" gap="base" paddingBlockStart="base">
          {pageInfo?.hasNextPage && pageInfo.endCursor ? (
            <s-link
              href={`/app/faq?after=${encodeURIComponent(pageInfo.endCursor)}`}
            >
              下一页
            </s-link>
          ) : null}
          {hasPrevPage ? <s-link href="/app/faq">第一页</s-link> : null}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
