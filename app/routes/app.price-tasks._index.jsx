import { Form, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import * as XLSX from "xlsx";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { formatBeijingDateTime } from "../lib/price-tasks.server";

const STATUS_LABELS = {
  Pending: "待执行",
  PriceChanging: "改价中",
  PriceChanged: "已改价",
  Restoring: "恢复中",
  Completed: "已完成",
  PartiallyFailed: "部分失败",
  Failed: "失败",
  Cancelled: "已取消",
};

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  if (!prisma.priceChangeTask) {
    return {
      setupError:
        "Prisma Client 尚未包含定时改价模型，请重启开发服务并执行 npx prisma generate。",
      tasks: [],
    };
  }

  const tasks = await prisma.priceChangeTask.findMany({
    where: { shop: session.shop },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return {
    setupError: null,
    tasks: tasks.map((task) => ({
      id: task.id,
      name: task.name,
      status: task.status,
      statusLabel: STATUS_LABELS[task.status] || task.status,
      scheduledChangeAt: formatBeijingDateTime(task.scheduledChangeAt),
      scheduledRestoreAt: formatBeijingDateTime(task.scheduledRestoreAt),
      totalCount: task.totalCount,
      successCount: task.successCount,
      failedCount: task.failedCount,
      createdAt: formatBeijingDateTime(task.createdAt),
    })),
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const taskId = Number(formData.get("taskId"));

  if (!taskId) return { ok: false, message: "任务 ID 无效" };

  const task = await prisma.priceChangeTask.findFirst({
    where: { id: taskId, shop: session.shop },
  });

  if (!task) return { ok: false, message: "任务不存在" };
  if (task.status !== "Pending") {
    return { ok: false, message: "只有待执行任务可以取消" };
  }

  await prisma.priceChangeTask.update({
    where: { id: taskId },
    data: { status: "Cancelled" },
  });

  return { ok: true, message: "任务已取消" };
};

export default function PriceTasksPage() {
  const { setupError, tasks } = useLoaderData();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const handleDownloadTemplate = () => {
    const rows = [
      { SKU: "ABC-001", "Target Price": 19.99 },
      { SKU: "ABC-002", "Target Price": 24.99 },
    ];
    const worksheet = XLSX.utils.json_to_sheet(rows, {
      header: ["SKU", "Target Price"],
    });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Price Task Template");
    const buffer = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "price-task-template.xlsx";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <s-page heading="定时改价任务" inlineSize="large">
      <s-section>
        <s-stack
          direction="inline"
          gap="base"
          alignItems="center"
          justifyContent="space-between"
        >
          <s-text tone="subdued">所有时间均为北京时间</s-text>
          <s-stack direction="inline" gap="small">
            <s-button
              type="button"
              variant="secondary"
              onClick={handleDownloadTemplate}
            >
              下载 Excel 模板
            </s-button>
            <s-link href="/app/price-tasks/new">
              <s-button variant="primary">新建任务</s-button>
            </s-link>
          </s-stack>
        </s-stack>
      </s-section>

      {setupError ? (
        <s-section>
          <s-banner tone="critical">{setupError}</s-banner>
        </s-section>
      ) : null}

      <s-section heading="任务列表">
        {tasks.length === 0 ? (
          <s-paragraph tone="subdued">暂无定时改价任务。</s-paragraph>
        ) : (
          <s-table variant="table" paginate={false}>
            <s-table-header-row>
              <s-table-header listSlot="primary">任务名称</s-table-header>
              <s-table-header>SKU 数量</s-table-header>
              <s-table-header>改价时间</s-table-header>
              <s-table-header>恢复时间</s-table-header>
              <s-table-header>状态</s-table-header>
              <s-table-header>结果</s-table-header>
              <s-table-header>操作</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {tasks.map((task) => (
                <s-table-row key={task.id}>
                  <s-table-cell>
                    <s-link href={`/app/price-tasks/${task.id}`}>
                      {task.name}
                    </s-link>
                  </s-table-cell>
                  <s-table-cell>{task.totalCount}</s-table-cell>
                  <s-table-cell>{task.scheduledChangeAt}</s-table-cell>
                  <s-table-cell>{task.scheduledRestoreAt}</s-table-cell>
                  <s-table-cell>{task.statusLabel}</s-table-cell>
                  <s-table-cell>
                    成功 {task.successCount} / 失败 {task.failedCount}
                  </s-table-cell>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small">
                      <s-link href={`/app/price-tasks/${task.id}`}>详情</s-link>
                      {task.status === "Pending" ? (
                        <Form method="post">
                          <input type="hidden" name="taskId" value={task.id} />
                          <s-button
                            type="submit"
                            variant="secondary"
                            disabled={isSubmitting}
                          >
                            取消
                          </s-button>
                        </Form>
                      ) : null}
                    </s-stack>
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
