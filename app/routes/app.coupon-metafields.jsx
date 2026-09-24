/* eslint-disable react/prop-types */
import { useEffect, useRef, useState } from "react";
import { Form, useActionData, useFetcher, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import * as XLSX from "xlsx";
import { authenticate } from "../shopify.server";
import {
  deleteCouponMetafields,
  importCouponCodes,
  matchCouponSkus,
  parseCouponExcel,
} from "../lib/coupon-metafields.server";

const COUPON_PAGE_PATH = "/app/coupon-metafields";
const MATCH_BATCH = 8;
const IMPORT_BATCH = 40;
const TABLE_PAGE_SIZE = 50;

const DELETE_COPY = {
  promp: {
    title: "批量删除 Coupon 元字段",
    description: "删除所有 SKU 上的 custom.coupon_code_by_promp 值。元字段定义会保留。",
    confirm: "将删除所有变体上的 custom.coupon_code_by_promp，此操作不可恢复。",
  },
  product: {
    title: "批量删除产品页 Coupon",
    description:
      "删除所有 SKU 上的 custom.coupon_code_by_promp 和 custom.coupon_code 值。元字段定义会保留。",
    confirm:
      "将删除所有变体上的 custom.coupon_code_by_promp 和 custom.coupon_code，此操作不可恢复。",
  },
};

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  const confirm = new URL(request.url).searchParams.get("confirm");
  return { confirm: confirm === "promp" || confirm === "product" ? confirm : null };
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("_action") || "");
  const runId = String(formData.get("runId") || "");

  try {
    if (intent === "parse") {
      const parsed = await parseCouponExcel(formData.get("file"));
      return { intent, runId, ...parsed };
    }

    if (intent === "match") {
      const items = parseJson(formData.get("skusJson"));
      const matched = await matchCouponSkus(admin, items);
      return { intent, runId, ...matched };
    }

    if (intent === "import") {
      const items = parseJson(formData.get("itemsJson"));
      const imported = await importCouponCodes(admin, items);
      return { intent, runId, received: items.length, ...imported };
    }

    if (intent === "delete") {
      const mode = String(formData.get("mode") || "");
      const cursor = String(formData.get("cursor") || "") || null;
      const resolvedRunId = runId || String(Date.now());
      const deleted = await deleteCouponMetafields(admin, mode, cursor);
      return { intent, runId: resolvedRunId, mode, ...deleted };
    }
  } catch (error) {
    return {
      intent,
      runId,
      ok: false,
      message: error instanceof Error ? error.message : "操作失败",
    };
  }

  return { intent, runId, ok: false, message: "操作无效" };
};

export default function CouponMetafieldsPage() {
  const { confirm } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const deleteFetcher = useFetcher();
  const importFetcher = useFetcher();
  const deleteRunId = useRef("");
  const importRunId = useRef("");
  const handledDelete = useRef(null);
  const handledImport = useRef(null);
  const lastDeleteCursor = useRef(null);
  const matchQueue = useRef([]);
  const writeQueue = useRef([]);

  const [pendingConfirm, setPendingConfirm] = useState(null);
  const [deleteJob, setDeleteJob] = useState(null);
  const [phase, setPhase] = useState("idle");
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState([]);
  const [tablePage, setTablePage] = useState(0);
  const [matchProgress, setMatchProgress] = useState({ done: 0, total: 0 });
  const [importProgress, setImportProgress] = useState(null);
  const [banner, setBanner] = useState(null);

  const deleteBusy = deleteFetcher.state !== "idle" || Boolean(deleteJob?.running);
  const importBusy = ["parsing", "matching", "importing"].includes(phase);
  const busy = deleteBusy || importBusy;
  const invalidCount = rows.filter((row) => row.errors.length > 0).length;
  const variantCount = rows.reduce((sum, row) => sum + (row.variants?.length || 0), 0);
  const allResolved =
    rows.length > 0 && rows.every((row) => row.matched || row.errors.length > 0);
  const canImport =
    (phase === "ready" || phase === "done") &&
    allResolved &&
    invalidCount === 0 &&
    variantCount > 0;
  const tablePages = Math.max(1, Math.ceil(rows.length / TABLE_PAGE_SIZE));
  const visibleRows = rows.slice(
    tablePage * TABLE_PAGE_SIZE,
    tablePage * TABLE_PAGE_SIZE + TABLE_PAGE_SIZE,
  );

  useEffect(() => {
    const data = deleteFetcher.data;
    if (deleteFetcher.state !== "idle" || !data || data.intent !== "delete") return;
    if (handledDelete.current === data) return;
    handledDelete.current = data;
    if (String(data.runId) !== deleteRunId.current) return;

    if (isRouteMiss(data)) {
      setDeleteJob((current) => ({
        ...(current || { mode: "", scanned: 0, deleted: 0, errors: [] }),
        running: false,
        done: false,
        message: "删除请求没有打到 Coupon 元字段页面，请刷新后重试。",
      }));
      return;
    }

    setDeleteJob((current) => {
      const scanned = (current?.scanned || 0) + (data.scanned || 0);
      const deleted = (current?.deleted || 0) + (data.deleted || 0);
      const errors = uniqueList([...(current?.errors || []), ...(data.errors || [])]);
      return {
        running: Boolean(data.ok && data.hasNextPage),
        mode: data.mode,
        scanned,
        deleted,
        errors,
        done: Boolean(data.ok && !data.hasNextPage),
        message: data.ok ? "" : data.message || "删除失败",
      };
    });

    if (data.ok && data.hasNextPage) {
      if (!data.cursor || data.cursor === lastDeleteCursor.current) {
        setDeleteJob((current) => ({
          ...current,
          running: false,
          done: true,
          message: "变体分页没有继续，删除已停止",
        }));
        return;
      }
      lastDeleteCursor.current = data.cursor;
      submitDelete(deleteFetcher, data.mode, data.cursor, data.runId);
    }
  }, [deleteFetcher]);

  useEffect(() => {
    if (!actionData || actionData.intent !== "delete") return;
    if (handledDelete.current === actionData) return;
    handledDelete.current = actionData;
    deleteRunId.current = String(actionData.runId || "");
    setDeleteJob({
      running: Boolean(actionData.ok && actionData.hasNextPage),
      mode: actionData.mode,
      scanned: actionData.scanned || 0,
      deleted: actionData.deleted || 0,
      errors: actionData.errors || [],
      done: Boolean(actionData.ok && !actionData.hasNextPage),
      message: actionData.ok ? "" : actionData.message || "删除失败",
    });
    if (actionData.ok && actionData.hasNextPage && actionData.cursor) {
      lastDeleteCursor.current = actionData.cursor;
      submitDelete(deleteFetcher, actionData.mode, actionData.cursor, actionData.runId);
    }
  }, [actionData, deleteFetcher]);

  useEffect(() => {
    const data = importFetcher.data;
    if (importFetcher.state !== "idle" || !data) return;
    if (handledImport.current === data) return;
    handledImport.current = data;
    if (String(data.runId) !== importRunId.current) return;

    if (data.intent === "parse") {
      const nextRows = (data.rows || []).map((row) => ({
        ...row,
        errors: row.errors || [],
        variants: [],
        matched: false,
      }));
      setRows(nextRows);
      setTablePage(0);
      setFileName(data.fileName || fileName);
      setImportProgress(null);

      if (!data.ok) {
        setPhase("ready");
        setBanner({ tone: "critical", message: data.message || "Excel 解析失败" });
        return;
      }

      const pending = nextRows.filter((row) => row.errors.length === 0);
      setMatchProgress({ done: 0, total: pending.length });
      if (pending.length === 0) {
        setPhase("ready");
        setBanner({ tone: "critical", message: "Excel 中没有可导入的 SKU" });
        return;
      }

      setPhase("matching");
      setBanner({ tone: "info", message: "正在根据 SKU 匹配产品变体..." });
      matchQueue.current = pending.slice(MATCH_BATCH);
      submitMatch(importFetcher, pending.slice(0, MATCH_BATCH), data.runId);
      return;
    }

    if (data.intent === "match") {
      if (!data.ok) {
        setPhase("ready");
        setBanner({ tone: "critical", message: data.message || "SKU 匹配失败" });
        return;
      }

      const resultByLine = new Map(
        (data.results || []).map((result) => [result.lineNumber, result]),
      );
      setRows((current) =>
        current.map((row) => {
          const result = resultByLine.get(row.lineNumber);
          if (!result) return row;
          return {
            ...row,
            matched: true,
            variants: result.variants || [],
            errors: result.error ? [...row.errors, result.error] : row.errors,
          };
        }),
      );
      setMatchProgress((current) => ({
        ...current,
        done: current.done + (data.results?.length || 0),
      }));

      if (matchQueue.current.length > 0) {
        const next = matchQueue.current.slice(0, MATCH_BATCH);
        matchQueue.current = matchQueue.current.slice(MATCH_BATCH);
        submitMatch(importFetcher, next, data.runId);
        return;
      }

      setPhase("ready");
      setBanner(null);
      return;
    }

    if (data.intent === "import") {
      setImportProgress((current) => {
        const failed = [...(current?.failed || []), ...(data.failed || [])];
        const success = (current?.success || 0) + (data.successCount || 0);
        const done = (current?.done || 0) + (data.received || 0);
        return {
          total: current?.total || 0,
          done: Math.min(done, current?.total || done),
          success,
          failed,
        };
      });

      if (!data.ok && data.message && !data.failed) {
        setPhase("ready");
        setBanner({ tone: "critical", message: data.message });
        return;
      }

      if (writeQueue.current.length > 0) {
        const next = writeQueue.current.slice(0, IMPORT_BATCH);
        writeQueue.current = writeQueue.current.slice(IMPORT_BATCH);
        submitImport(importFetcher, next, data.runId);
        return;
      }

      setPhase("done");
      setBanner(null);
    }
  }, [fileName, importFetcher]);

  const handleDownloadTemplate = () => {
    const worksheet = XLSX.utils.json_to_sheet(
      [
        { SKU: "ABC-001", "Coupon Code": "SAVE10" },
        { SKU: "ABC-002", "Coupon Code": "SAVE20" },
      ],
      { header: ["SKU", "Coupon Code"] },
    );
    worksheet["!cols"] = [{ wch: 24 }, { wch: 24 }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Coupon Code");
    const buffer = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "coupon-code-template.xlsx";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const handleFileChange = (event) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file || busy) return;

    const runId = String(Date.now());
    importRunId.current = runId;
    matchQueue.current = [];
    writeQueue.current = [];
    setPendingConfirm(null);
    setBanner(null);
    setPhase("parsing");
    setFileName(file.name);
    setRows([]);
    setImportProgress(null);

    const formData = new FormData();
    formData.set("_action", "parse");
    formData.set("runId", runId);
    formData.set("file", file);
    importFetcher.submit(formData, {
      method: "post",
      action: COUPON_PAGE_PATH,
      encType: "multipart/form-data",
    });
  };

  const runImport = () => {
    const items = rows.flatMap((row) =>
      (row.variants || []).map((variant) => ({
        ownerId: variant.id,
        sku: row.sku,
        couponCode: row.couponCode,
        productTitle: variant.productTitle,
      })),
    );
    if (items.length === 0) return;

    setPendingConfirm(null);
    setPhase("importing");
    setBanner({ tone: "info", message: "正在写入变体上的 custom.coupon_code..." });
    setImportProgress({ total: items.length, done: 0, success: 0, failed: [] });
    writeQueue.current = items.slice(IMPORT_BATCH);
    submitImport(importFetcher, items.slice(0, IMPORT_BATCH), importRunId.current);
  };

  const deleteTone = deleteJob?.message
    ? "critical"
    : deleteJob?.done
      ? deleteJob.errors.length
        ? "warning"
        : "success"
      : "info";
  const importDone = phase === "done" && importProgress;
  const submittingAction = String(navigation.formData?.get("_action") || "");
  const submittingMode = String(navigation.formData?.get("mode") || "");

  return (
    <s-page heading="Coupon 元字段" inlineSize="large">
      <s-section>
        <s-text tone="subdued">
          custom.coupon_code 是变体上的元字段定义。这里只修改各 SKU
          上的值，同一个 SKU 出现在多个产品中时会全部处理。
        </s-text>
      </s-section>

      <s-section heading="批量删除">
        {deleteJob ? (
          <s-box paddingBlockEnd="base">
            <s-banner tone={deleteTone}>
              <s-paragraph>
                {deleteJob.message
                  ? deleteJob.message
                  : deleteJob.done
                    ? "删除完成。"
                    : "正在删除，请保持页面打开。"}
                {` 已检查 ${deleteJob.scanned} 个变体，已删除 ${deleteJob.deleted} 个元字段值。`}
              </s-paragraph>
              {deleteJob.errors.length ? (
                <s-unordered-list>
                  {deleteJob.errors.map((error) => (
                    <s-list-item key={error}>{error}</s-list-item>
                  ))}
                </s-unordered-list>
              ) : null}
            </s-banner>
          </s-box>
        ) : null}

        <div style={cardGridStyle}>
          {Object.entries(DELETE_COPY).map(([mode, copy]) => (
            <div key={mode} style={cardStyle}>
              <div style={cardTitleStyle}>{copy.title}</div>
              <p style={cardTextStyle}>{copy.description}</p>
              {confirm === mode && actionData?.intent !== "delete" ? (
                <div style={confirmBoxStyle}>
                  <p style={cardTextStyle}>{copy.confirm}</p>
                  <div style={actionRowStyle}>
                    <Form method="post">
                      <input type="hidden" name="_action" value="delete" />
                      <input type="hidden" name="mode" value={mode} />
                      <s-button
                        type="submit"
                        variant="primary"
                        tone="critical"
                        loading={submittingAction === "delete" && submittingMode === mode}
                      >
                        {submittingAction === "delete" && submittingMode === mode
                          ? "删除中..."
                          : "确认删除"}
                      </s-button>
                    </Form>
                    <s-button href={COUPON_PAGE_PATH} variant="secondary">
                      取消
                    </s-button>
                  </div>
                </div>
              ) : (
                <s-button
                  href={`${COUPON_PAGE_PATH}?confirm=${mode}`}
                  variant="primary"
                  tone="critical"
                >
                  {deleteJob?.running && deleteJob.mode === mode ? "删除中..." : "一键删除"}
                </s-button>
              )}
            </div>
          ))}
        </div>
      </s-section>

      <s-section heading="批量导入">
        <div style={importHeaderStyle}>
          <p style={cardTextStyle}>
            上传 Excel 后，按已有的变体元字段定义写入 custom.coupon_code。模板列为 SKU、Coupon
            Code。
          </p>
          <s-button type="button" variant="secondary" onClick={handleDownloadTemplate}>
            下载示例 Excel 模板
          </s-button>
        </div>

        {banner ? (
          <s-box paddingBlockEnd="base">
            <s-banner tone={banner.tone}>{banner.message}</s-banner>
          </s-box>
        ) : null}

        {importDone ? (
          <s-box paddingBlockEnd="base">
            <s-banner tone={importProgress.failed.length ? "warning" : "success"}>
              <s-paragraph>
                {`导入结束。成功写入 ${importProgress.success} 个变体，失败 ${importProgress.failed.length} 个。`}
              </s-paragraph>
              {importProgress.failed.length ? (
                <s-unordered-list>
                  {importProgress.failed.slice(0, 10).map((item, index) => (
                    <s-list-item key={`${item.sku}-${index}`}>
                      {[item.sku, item.productTitle, item.message].filter(Boolean).join("：")}
                    </s-list-item>
                  ))}
                </s-unordered-list>
              ) : null}
            </s-banner>
          </s-box>
        ) : null}

        <div style={uploadBoxStyle}>
          <div style={cardTitleStyle}>Excel 文件</div>
          <p style={cardTextStyle}>
            {fileName
              ? `当前文件：${fileName}`
              : "选择 .xlsx 或 .xls 文件后会自动解析并匹配 SKU。"}
          </p>
          <input
            type="file"
            accept=".xlsx,.xls"
            disabled={busy}
            onChange={handleFileChange}
          />
        </div>

        {phase === "parsing" || phase === "matching" ? (
          <s-box paddingBlockStart="base">
            <s-banner tone="info">
              {phase === "parsing"
                ? "正在解析 Excel..."
                : `正在匹配 SKU ${matchProgress.done} / ${matchProgress.total}`}
            </s-banner>
          </s-box>
        ) : null}

        {phase === "importing" && importProgress ? (
          <s-box paddingBlockStart="base">
            <s-banner tone="info">
              {`正在写入 ${Math.min(importProgress.done, importProgress.total)} / ${importProgress.total} 个变体`}
            </s-banner>
          </s-box>
        ) : null}

        {rows.length > 0 ? (
          <s-box paddingBlockStart="base">
            <s-box paddingBlockEnd="base">
              <s-text>
                {`共 ${rows.length} 行，可匹配变体 ${variantCount} 个，校验失败 ${invalidCount} 行。`}
              </s-text>
            </s-box>
            <s-table variant="table" paginate={false}>
              <s-table-header-row>
                <s-table-header>行号</s-table-header>
                <s-table-header listSlot="primary">SKU</s-table-header>
                <s-table-header>Coupon Code</s-table-header>
                <s-table-header>匹配变体</s-table-header>
                <s-table-header>产品</s-table-header>
                <s-table-header>结果</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {visibleRows.map((row) => (
                  <s-table-row key={`${row.lineNumber}-${row.sku}`}>
                    <s-table-cell>{row.lineNumber}</s-table-cell>
                    <s-table-cell>{row.sku || "-"}</s-table-cell>
                    <s-table-cell>{row.couponCode || "-"}</s-table-cell>
                    <s-table-cell>{row.matched ? row.variants.length : "-"}</s-table-cell>
                    <s-table-cell>{formatVariantTargets(row.variants)}</s-table-cell>
                    <s-table-cell>{formatRowResult(row, phase)}</s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>

            {tablePages > 1 ? (
              <div style={pagerStyle}>
                <s-button
                  type="button"
                  variant="secondary"
                  disabled={tablePage === 0 ? true : undefined}
                  onClick={() => setTablePage((page) => page - 1)}
                >
                  上一页
                </s-button>
                <s-text>
                  {tablePage + 1} / {tablePages}
                </s-text>
                <s-button
                  type="button"
                  variant="secondary"
                  disabled={tablePage + 1 >= tablePages ? true : undefined}
                  onClick={() => setTablePage((page) => page + 1)}
                >
                  下一页
                </s-button>
              </div>
            ) : null}

            <div style={actionRowStyle}>
              {pendingConfirm === "import" ? (
                <>
                  <s-text>{`将为 ${variantCount} 个变体写入 custom.coupon_code。`}</s-text>
                  <s-button
                    type="button"
                    variant="primary"
                    disabled={!canImport || busy ? true : undefined}
                    onClick={runImport}
                  >
                    确认导入
                  </s-button>
                  <s-button type="button" variant="secondary" onClick={() => setPendingConfirm(null)}>
                    取消
                  </s-button>
                </>
              ) : (
                <s-button
                  type="button"
                  variant="primary"
                  disabled={!canImport || busy ? true : undefined}
                  onClick={() => setPendingConfirm("import")}
                >
                  {phase === "importing" ? "导入中..." : "确认导入"}
                </s-button>
              )}
            </div>
          </s-box>
        ) : null}
      </s-section>
    </s-page>
  );
}

function submitDelete(fetcher, mode, cursor, runId) {
  const formData = new FormData();
  formData.set("_action", "delete");
  formData.set("mode", mode);
  formData.set("cursor", cursor || "");
  formData.set("runId", String(runId));
  fetcher.submit(formData, { method: "post", action: COUPON_PAGE_PATH });
}

function submitMatch(fetcher, batch, runId) {
  const formData = new FormData();
  formData.set("_action", "match");
  formData.set("runId", String(runId));
  formData.set(
    "skusJson",
    JSON.stringify(batch.map((row) => ({ lineNumber: row.lineNumber, sku: row.sku }))),
  );
  fetcher.submit(formData, { method: "post", action: COUPON_PAGE_PATH });
}

function submitImport(fetcher, batch, runId) {
  const formData = new FormData();
  formData.set("_action", "import");
  formData.set("runId", String(runId));
  formData.set(
    "itemsJson",
    JSON.stringify(
      batch.map((item) => ({
        ownerId: item.ownerId,
        sku: item.sku,
        couponCode: item.couponCode,
        productTitle: item.productTitle,
      })),
    ),
  );
  fetcher.submit(formData, { method: "post", action: COUPON_PAGE_PATH });
}

function parseJson(value) {
  const parsed = JSON.parse(String(value || "[]"));
  return Array.isArray(parsed) ? parsed : [];
}

function isRouteMiss(data) {
  const message = String(data?.message || data?.statusText || "");
  return message.includes("No route matches");
}

function formatVariantTargets(variants) {
  if (!variants?.length) return "-";
  const labels = variants.map((variant) => {
    const variantName =
      variant.title && variant.title !== "Default Title" ? ` / ${variant.title}` : "";
    return `${variant.productTitle || "未命名产品"}${variantName}`;
  });
  if (labels.length <= 3) return labels.join("、");
  return `${labels.slice(0, 3).join("、")} 等 ${labels.length} 个变体`;
}

function formatRowResult(row, phase) {
  if (row.errors?.length) return row.errors.join("；");
  if (!row.matched && (phase === "matching" || phase === "parsing")) return "匹配中";
  if (row.matched) return "通过";
  return "-";
}

function uniqueList(items) {
  return [...new Set(items.filter(Boolean))].slice(0, 10);
}

const cardGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
  gap: "1rem",
};

const cardStyle = {
  padding: "16px",
  border: "1px solid #e3e3e3",
  borderRadius: "12px",
  background: "#ffffff",
};

const cardTitleStyle = {
  marginBottom: "0.5rem",
  color: "#303030",
  fontWeight: 650,
};

const cardTextStyle = {
  margin: "0 0 1rem",
  color: "#616161",
  fontSize: "0.875rem",
  lineHeight: 1.5,
};

const confirmBoxStyle = {
  padding: "12px",
  borderRadius: "8px",
  background: "#fff4f4",
};

const importHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  flexWrap: "wrap",
  gap: "1rem",
  marginBottom: "1rem",
};

const uploadBoxStyle = {
  padding: "16px",
  border: "1px dashed #b5b5b5",
  borderRadius: "8px",
  background: "#fbfbfb",
};

const actionRowStyle = {
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: "0.75rem",
  marginTop: "1rem",
};

const pagerStyle = {
  display: "flex",
  alignItems: "center",
  gap: "0.75rem",
  marginTop: "1rem",
};

export const headers = (headersArgs) => boundary.headers(headersArgs);
