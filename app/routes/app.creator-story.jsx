import { useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import {
  hasCreatorStoryModel,
  isMissingCreatorStoryTableError,
  serializeCreatorStory,
} from "../lib/creator-story.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  if (!hasCreatorStoryModel()) {
    return {
      setupError:
        "Prisma Client 尚未包含 Creator Story 模型，请执行数据库迁移并重新生成 Prisma Client。",
      stories: [],
    };
  }

  try {
    const stories = await prisma.creatorStory.findMany({
      where: { shop: session.shop },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return {
      setupError: null,
      stories: stories.map(serializeCreatorStory),
    };
  } catch (error) {
    if (!isMissingCreatorStoryTableError(error)) throw error;
    return {
      setupError: "Creator Story 数据表尚未创建，请先执行 npm run db:deploy。",
      stories: [],
    };
  }
};

export default function CreatorStoryPage() {
  const { stories, setupError } = useLoaderData();

  return (
    <s-page heading="Creator Stories">
      <s-section>
        <s-paragraph>
          前台主题区块「Creator Story」提交的用户故事会保存在这里，上传的图片/视频会写入店铺
          Files。
        </s-paragraph>
        {setupError ? (
          <s-banner tone="critical">{setupError}</s-banner>
        ) : (
          <s-banner tone="info">共 {stories.length} 条记录（最多显示 200 条）</s-banner>
        )}
      </s-section>

      <s-section>
        <s-table>
          <s-table-header-row>
            <s-table-header>时间</s-table-header>
            <s-table-header>姓名</s-table-header>
            <s-table-header>邮箱</s-table-header>
            <s-table-header>国家/地区</s-table-header>
            <s-table-header>订单号</s-table-header>
            <s-table-header>媒体</s-table-header>
            <s-table-header>故事</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {stories.length === 0 ? (
              <s-table-row>
                <s-table-cell colSpan={7}>暂无提交记录</s-table-cell>
              </s-table-row>
            ) : (
              stories.map((row) => (
                <s-table-row key={row.id}>
                  <s-table-cell>
                    {new Date(row.createdAt).toLocaleString()}
                  </s-table-cell>
                  <s-table-cell>{row.name}</s-table-cell>
                  <s-table-cell>{row.email}</s-table-cell>
                  <s-table-cell>{row.country}</s-table-cell>
                  <s-table-cell>{row.orderNumber || "—"}</s-table-cell>
                  <s-table-cell>
                    {row.mediaFiles?.length ? (
                      <div style={{ display: "grid", gap: "0.25rem" }}>
                        {row.mediaFiles.map((file) => (
                          <s-link
                            key={file.id || file.url}
                            href={file.url || "#"}
                            target="_blank"
                          >
                            {file.fileName || "查看文件"}
                          </s-link>
                        ))}
                      </div>
                    ) : row.mediaFileUrl ? (
                      <s-link href={row.mediaFileUrl} target="_blank">
                        {row.mediaFileName || "查看文件"}
                      </s-link>
                    ) : (
                      "—"
                    )}
                  </s-table-cell>
                  <s-table-cell>
                    <span style={{ whiteSpace: "pre-wrap" }}>
                      {row.story.length > 120
                        ? `${row.story.slice(0, 120)}…`
                        : row.story}
                    </span>
                  </s-table-cell>
                </s-table-row>
              ))
            )}
          </s-table-body>
        </s-table>
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
