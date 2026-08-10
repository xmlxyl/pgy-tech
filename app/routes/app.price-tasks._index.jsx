/* eslint-disable react/prop-types */
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import * as XLSX from "xlsx";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import {
  applyCompareAtPriceTask,
  formatBeijingDateTime,
  restorePriceTask,
} from "../lib/price-tasks.server";

const STATUS_LABELS = {
  Pending: "待修改",
  PriceChanging: "修改中",
  PriceChanged: "已修改",
  Restoring: "恢复中",
  Completed: "已恢复",
  PartiallyFailed: "部分失败",
  Failed: "失败",
  Cancelled: "已取消",
};

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  if (!prisma.priceChangeTask) {
    return {
      setupError:
        "Prisma Client 尚未包含价格任务模型，请重启开发服务并执行 npx prisma generate。",
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
      totalCount: task.totalCount,
      successCount: task.successCount,
      failedCount: task.failedCount,
      createdAt: formatBeijingDateTime(task.createdAt),
    })),
  };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const taskId = Number(formData.get("taskId"));
  const intent = String(formData.get("_action") || "");

  if (!taskId) return { ok: false, message: "任务 ID 无效" };

  if (intent === "apply") {
    const result = await applyCompareAtPriceTask(admin, session.shop, taskId);
    return {
      ok: result.ok,
      message: result.ok ? "修改价格已执行" : result.message,
    };
  }

  if (intent === "restore") {
    const result = await restorePriceTask(admin, session.shop, taskId);
    return {
      ok: result.ok,
      message: result.ok ? "恢复价格已执行" : result.message,
    };
  }

  return { ok: false, message: "操作无效" };
};

export default function PriceTasksPage() {
  const { setupError, tasks } = useLoaderData();
  const actionData = useActionData();
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
    link.download = "compare-at-price-template.xlsx";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <s-page heading="划线价修改" inlineSize="large">
      <s-section>
        <s-stack
          direction="inline"
          gap="base"
          alignItems="center"
          justifyContent="space-between"
        >
          <s-text tone="subdued">
            上传 SKU 和目标价格后，可手动修改为划线价或恢复原价。
          </s-text>
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

      {actionData?.message ? (
        <s-section>
          <s-banner tone={actionData.ok ? "success" : "critical"}>
            {actionData.message}
          </s-banner>
        </s-section>
      ) : null}

      {setupError ? (
        <s-section>
          <s-banner tone="critical">{setupError}</s-banner>
        </s-section>
      ) : null}

      <s-section heading="任务列表">
        {tasks.length === 0 ? (
          <s-paragraph tone="subdued">暂无划线价修改任务。</s-paragraph>
        ) : (
          <s-table variant="table" paginate={false}>
            <s-table-header-row>
              <s-table-header listSlot="primary">任务名称</s-table-header>
              <s-table-header>SKU 数量</s-table-header>
              <s-table-header>状态</s-table-header>
              <s-table-header>结果</s-table-header>
              <s-table-header>创建时间</s-table-header>
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
                  <s-table-cell>{task.statusLabel}</s-table-cell>
                  <s-table-cell>
                    成功 {task.successCount} / 失败 {task.failedCount}
                  </s-table-cell>
                  <s-table-cell>{task.createdAt}</s-table-cell>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small">
                      <s-link href={`/app/price-tasks/${task.id}`}>详情</s-link>
                      <TaskAction
                        taskId={task.id}
                        action="apply"
                        disabled={isSubmitting}
                      >
                        修改价格
                      </TaskAction>
                      <TaskAction
                        taskId={task.id}
                        action="restore"
                        disabled={isSubmitting}
                      >
                        恢复价格
                      </TaskAction>
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

function TaskAction({ taskId, action, disabled, children }) {
  return (
    <Form method="post">
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="_action" value={action} />
      <s-button type="submit" variant="secondary" disabled={disabled}>
        {children}
      </s-button>
    </Form>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
