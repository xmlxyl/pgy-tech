import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { formatBeijingDateTime } from "../lib/price-tasks.server";

const STATUS_LABELS = {
  Pending: "待修改",
  PriceChanging: "修改中",
  PriceChanged: "已修改",
  Restoring: "恢复中",
  Completed: "已恢复",
  PartiallyFailed: "部分失败",
  Failed: "失败",
  Cancelled: "已取消",
  Success: "成功",
  Skipped: "已跳过",
};

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const id = Number(params.id);
  const task = await prisma.priceChangeTask.findFirst({
    where: { id, shop: session.shop },
    include: { items: { orderBy: { id: "asc" } } },
  });

  if (!task) {
    throw new Response("任务不存在", { status: 404 });
  }

  return {
    task: {
      id: task.id,
      name: task.name,
      status: STATUS_LABELS[task.status] || task.status,
      fileName: task.fileName,
      totalCount: task.totalCount,
      successCount: task.successCount,
      failedCount: task.failedCount,
      createdAt: formatBeijingDateTime(task.createdAt),
      items: task.items.map((item) => ({
        id: item.id,
        sku: item.sku,
        originalPrice: item.originalPrice.toString(),
        targetPrice: item.targetPrice.toString(),
        changeStatus: STATUS_LABELS[item.changeStatus] || item.changeStatus,
        restoreStatus: STATUS_LABELS[item.restoreStatus] || item.restoreStatus,
        errorMessage: item.errorMessage,
      })),
    },
  };
};

export default function PriceTaskDetailPage() {
  const { task } = useLoaderData();

  return (
    <s-page heading={task.name} inlineSize="large">
      <s-section>
        <s-link href="/app/price-tasks">
          <s-button variant="secondary">返回列表</s-button>
        </s-link>
      </s-section>

      <s-section heading="任务信息">
        <s-stack gap="small">
          <s-text>状态：{task.status}</s-text>
          <s-text>Excel 文件：{task.fileName}</s-text>
          <s-text>
            SKU 总数：{task.totalCount}，成功：{task.successCount}，失败：
            {task.failedCount}
          </s-text>
          <s-text>创建时间（北京时间）：{task.createdAt}</s-text>
        </s-stack>
      </s-section>

      <s-section heading="SKU 明细">
        <s-table variant="table" paginate={false}>
          <s-table-header-row>
            <s-table-header listSlot="primary">SKU</s-table-header>
            <s-table-header>原价</s-table-header>
            <s-table-header>目标价格</s-table-header>
            <s-table-header>修改状态</s-table-header>
            <s-table-header>恢复状态</s-table-header>
            <s-table-header>错误原因</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {task.items.map((item) => (
              <s-table-row key={item.id}>
                <s-table-cell>{item.sku}</s-table-cell>
                <s-table-cell>{item.originalPrice}</s-table-cell>
                <s-table-cell>{item.targetPrice}</s-table-cell>
                <s-table-cell>{item.changeStatus}</s-table-cell>
                <s-table-cell>{item.restoreStatus}</s-table-cell>
                <s-table-cell>{item.errorMessage || "-"}</s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
