import { boundary } from "@shopify/shopify-app-react-router/server";
import { useLoaderData } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

/** @param {{ request: Request }} args */
export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  const emails = await prisma.savedEmail.findMany({
    where: { shop: session.shop },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return {
    emails: emails.map((row) => ({
      id: row.id,
      email: row.email,
      createdAt: row.createdAt.toISOString(),
    })),
  };
};

export default function EmailPage() {
  const { emails } = useLoaderData();

  return (
    <s-page heading="邮箱收集" inlineSize="base">
      <s-section heading="在线商店设置">
        <s-paragraph>
          顾客在店铺前台填写邮箱，数据会保存在下方列表中。请按以下步骤添加区块：
        </s-paragraph>
        <s-unordered-list>
          <s-list-item>
            进入 <strong>在线商店 → 主题 → 自定义</strong>
          </s-list-item>
          <s-list-item>
            在首页或任意支持应用区块的 Section 中，点击 <strong>添加区块</strong>
          </s-list-item>
          <s-list-item>
            选择应用区块 <strong>邮箱订阅</strong>，保存主题
          </s-list-item>
        </s-unordered-list>
        <s-paragraph tone="subdued">
          顾客提交后，邮箱会写入应用数据库（按店铺区分）。
        </s-paragraph>
      </s-section>

      <s-section heading="顾客提交记录">
        {emails.length === 0 ? (
          <s-paragraph tone="subdued">暂无记录。添加主题区块后，顾客即可在前台订阅。</s-paragraph>
        ) : (
          <s-table variant="table" paginate={false}>
            <s-table-header-row>
              <s-table-header listSlot="primary">邮箱</s-table-header>
              <s-table-header>提交时间</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {emails.map((row) => (
                <s-table-row key={row.id}>
                  <s-table-cell>{row.email}</s-table-cell>
                  <s-table-cell>
                    {new Date(row.createdAt).toLocaleString("zh-CN")}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
