import { useCallback, useMemo, useState } from "react";
import { useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { downloadEmailExport } from "../lib/email-export.js";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

/** @param {{ request: Request }} args */
export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  const emails = await prisma.savedEmail.findMany({
    where: { shop: session.shop },
    orderBy: { createdAt: "desc" },
  });

  return {
    emails: emails.map((row) => ({
      id: row.id,
      email: row.email,
      username: row.username,
      createdAt: row.createdAt.toISOString(),
    })),
  };
};

export default function EmailPage() {
  const { emails } = useLoaderData();
  const shopify = useAppBridge();
  const [selectedIds, setSelectedIds] = useState(/** @type {number[]} */ ([]));

  const allSelected =
    emails.length > 0 && selectedIds.length === emails.length;
  const someSelected =
    selectedIds.length > 0 && selectedIds.length < emails.length;
  const noneSelected = selectedIds.length === 0;

  const handleSelectAll = useCallback(
    /** @param {Event} event */
    (event) => {
      const checked = /** @type {HTMLInputElement} */ (event.target).checked;
      setSelectedIds(checked ? emails.map((row) => row.id) : []);
    },
    [emails],
  );

  const handleSelectRow = useCallback(
    /** @param {number} id */
    (id) => {
      setSelectedIds((current) =>
        current.includes(id)
          ? current.filter((value) => value !== id)
          : [...current, id],
      );
    },
    [],
  );

  const handleExport = useCallback(
    /** @param {"csv" | "xlsx"} format @param {"all" | "selected"} scope */
    (format, scope) => {
      if (scope === "selected" && selectedIds.length === 0) {
        shopify.toast.show("请先勾选要导出的记录", { isError: true });
        return;
      }

      const rows =
        scope === "all"
          ? emails
          : emails.filter((row) => selectedIds.includes(row.id));

      downloadEmailExport(rows, format);
      shopify.toast.show(`已导出 ${rows.length} 条记录`);
    },
    [emails, selectedIds, shopify],
  );

  const exportButtons = useMemo(
    () => (
      <s-stack direction="inline" gap="small">
        <s-button variant="secondary" onClick={() => handleExport("csv", "all")}>
          导出 CSV（全部）
        </s-button>
        <s-button
          variant="secondary"
          disabled={noneSelected}
          onClick={() => handleExport("csv", "selected")}
        >
          导出 CSV（已选）
        </s-button>
        <s-button variant="secondary" onClick={() => handleExport("xlsx", "all")}>
          导出 Excel（全部）
        </s-button>
        <s-button
          variant="secondary"
          disabled={noneSelected}
          onClick={() => handleExport("xlsx", "selected")}
        >
          导出 Excel（已选）
        </s-button>
      </s-stack>
    ),
    [handleExport, noneSelected],
  );

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
          <s-paragraph tone="subdued">
            暂无记录。添加主题区块后，顾客即可在前台订阅。
          </s-paragraph>
        ) : (
          <s-table variant="table" paginate={false}>
            {!noneSelected ? (
              <s-box slot="filters" padding="small" background="strong">
                <s-stack
                  direction="inline"
                  gap="base"
                  alignItems="center"
                  justifyContent="space-between"
                >
                  <s-text fontWeight="semibold">
                    已选 {selectedIds.length} / {emails.length}
                  </s-text>
                  {exportButtons}
                </s-stack>
              </s-box>
            ) : (
              <s-box slot="filters" padding="small">
                <s-stack
                  direction="inline"
                  gap="base"
                  alignItems="center"
                  justifyContent="space-between"
                >
                  <s-text tone="subdued">共 {emails.length} 条记录</s-text>
                  {exportButtons}
                </s-stack>
              </s-box>
            )}
            <s-table-header-row>
              <s-table-header listSlot="primary">
                <s-stack direction="inline" gap="small" alignItems="center">
                  <s-checkbox
                    checked={allSelected}
                    indeterminate={someSelected}
                    onChange={handleSelectAll}
                    accessibilityLabel="全选记录"
                  />
                  <s-text>邮箱</s-text>
                </s-stack>
              </s-table-header>
              <s-table-header>用户名</s-table-header>
              <s-table-header>提交时间</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {emails.map((row) => (
                <s-table-row
                  key={row.id}
                  selected={selectedIds.includes(row.id)}
                  clickDelegate={`email-row-${row.id}-checkbox`}
                >
                  <s-table-cell>
                    <s-stack direction="inline" gap="small" alignItems="center">
                      <s-checkbox
                        id={`email-row-${row.id}-checkbox`}
                        checked={selectedIds.includes(row.id)}
                        onChange={() => handleSelectRow(row.id)}
                        accessibilityLabel={`选择 ${row.email}`}
                      />
                      <s-text>{row.email}</s-text>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>{row.username || "—"}</s-table-cell>
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
