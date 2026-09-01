/* eslint-disable react/prop-types */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Form,
  redirect,
  useActionData,
  useFetcher,
  useLoaderData,
  useNavigation,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import {
  MANUAL_PAGE_SIZE,
  MANUAL_PRODUCT_SERIES,
  hasManualModel,
  isMissingManualTableError,
  listManualFiles,
  normalizeManualSeries,
  normalizeManualSku,
  serializeManual,
} from "../lib/manuals.server";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const fileQuery = url.searchParams.get("fileQuery") || "";

  if (!hasManualModel()) {
    return {
      setupError:
        "Prisma Client 尚未包含用户手册模型，请执行数据库迁移并重新生成 Prisma Client。",
      manuals: [],
      files: [],
      page,
      pageSize: MANUAL_PAGE_SIZE,
      total: 0,
      totalPages: 1,
      productSeries: MANUAL_PRODUCT_SERIES,
      fileQuery,
    };
  }

  let manuals = [];
  let total = 0;
  let setupError = null;
  try {
    const where = { shop: session.shop };
    [manuals, total] = await Promise.all([
      prisma.userManual.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * MANUAL_PAGE_SIZE,
        take: MANUAL_PAGE_SIZE,
      }),
      prisma.userManual.count({ where }),
    ]);
  } catch (error) {
    if (!isMissingManualTableError(error)) throw error;
    setupError = "用户手册数据库表尚未创建，请先执行 npm run db:deploy。";
  }

  let files = [];
  let fileError = null;
  try {
    files = await listManualFiles(admin, fileQuery);
  } catch (error) {
    console.error("[manual-file-list]", error);
    fileError =
      "读取 Shopify Files 失败，请确认应用权限包含 read_files 并重新授权。";
  }

  return {
    setupError,
    fileError,
    manuals: manuals.map(serializeManual),
    files,
    page,
    pageSize: MANUAL_PAGE_SIZE,
    total,
    totalPages: Math.max(1, Math.ceil(total / MANUAL_PAGE_SIZE)),
    productSeries: MANUAL_PRODUCT_SERIES,
    fileQuery,
  };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("_action") || "create");

  if (intent === "searchFiles") {
    try {
      const files = await listManualFiles(admin, formData.get("fileQuery"));
      return { ok: true, files };
    } catch (error) {
      console.error("[manual-file-search]", error);
      return {
        ok: false,
        message:
          "搜索 Shopify Files 失败，请确认应用权限包含 read_files 并重新授权。",
        files: [],
      };
    }
  }

  if (!hasManualModel()) {
    return {
      ok: false,
      message:
        "Prisma Client 尚未包含用户手册模型，请执行数据库迁移并重新生成 Prisma Client。",
    };
  }

  if (intent === "delete") {
    const id = Number(formData.get("id"));
    if (!id) return { ok: false, message: "手册 ID 无效" };
    try {
      await prisma.userManual.deleteMany({
        where: { id, shop: session.shop },
      });
    } catch (error) {
      if (isMissingManualTableError(error)) {
        return { ok: false, message: "用户手册数据库表尚未创建。" };
      }
      throw error;
    }
    return redirect("/app/manuals");
  }

  const id = Number(formData.get("id"));
  const title = String(formData.get("title") || "").trim();
  const fileName = String(formData.get("fileName") || "").trim();
  const sku = normalizeManualSku(formData.get("sku"));
  const productSeries = normalizeManualSeries(formData.get("productSeries"));
  const fileId = String(formData.get("fileId") || "").trim();
  const fileUrl = String(formData.get("fileUrl") || "").trim();
  const errors = [];

  if (!title) errors.push("标题不能为空");
  if (!fileName) errors.push("文件名字不能为空");
  if (!sku) errors.push("SKU 不能为空");
  if (!productSeries) errors.push("请选择产品系列");
  if (!fileId || !fileUrl) errors.push("请选择 Shopify Files 中的文件");

  if (errors.length) {
    return { ok: false, message: errors.join("；") };
  }

  try {
    const data = {
      title,
      fileName,
      sku,
      productSeries,
      fileId,
      fileUrl,
    };
    if (intent === "update") {
      if (!id) return { ok: false, message: "手册 ID 无效" };
      await prisma.userManual.updateMany({
        where: { id, shop: session.shop },
        data,
      });
    } else {
      await prisma.userManual.create({
        data: {
          shop: session.shop,
          ...data,
        },
      });
    }
  } catch (error) {
    if (isMissingManualTableError(error)) {
      return { ok: false, message: "用户手册数据库表尚未创建。" };
    }
    throw error;
  }

  return {
    ok: true,
    message: intent === "update" ? "用户手册已更新" : "用户手册已保存",
  };
};

export default function ManualsPage() {
  const {
    setupError,
    fileError,
    manuals,
    files,
    page,
    pageSize,
    total,
    totalPages,
    productSeries,
    fileQuery,
  } = useLoaderData();
  const shopify = useAppBridge();
  const actionData = useActionData();
  const createFetcher = useFetcher();
  const fileSearchFetcher = useFetcher();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const isSavingManual = createFetcher.state !== "idle";
  const isSearchingFiles = fileSearchFetcher.state !== "idle";
  const [modalOpen, setModalOpen] = useState(false);
  const [editingManual, setEditingManual] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [manualTitle, setManualTitle] = useState("");
  const [manualSku, setManualSku] = useState("");
  const [manualSeries, setManualSeries] = useState("");
  const [fileSearchQuery, setFileSearchQuery] = useState(fileQuery || "");

  const selectedFileName = selectedFile?.fileName || "";
  const selectedFileUrl = selectedFile?.fileUrl || "";
  const selectedFileId = selectedFile?.id || "";

  useEffect(() => {
    if (!createFetcher.data || createFetcher.state !== "idle") return;

    if (createFetcher.data.ok) {
      shopify.toast.show(createFetcher.data.message || "用户手册已保存");
      setModalOpen(false);
      setEditingManual(null);
      setSelectedFile(null);
      setManualTitle("");
      setManualSku("");
      setManualSeries("");
      return;
    }

    shopify.toast.show(createFetcher.data.message || "保存失败", {
      isError: true,
    });
  }, [createFetcher.data, createFetcher.state, shopify]);

  useEffect(() => {
    if (!fileSearchFetcher.data || fileSearchFetcher.state !== "idle") return;
    if (fileSearchFetcher.data.ok) return;

    shopify.toast.show(fileSearchFetcher.data.message || "搜索文件失败", {
      isError: true,
    });
  }, [fileSearchFetcher.data, fileSearchFetcher.state, shopify]);

  const openAddModal = useCallback(() => {
    setEditingManual(null);
    setSelectedFile(null);
    setManualTitle("");
    setManualSku("");
    setManualSeries("");
    setModalOpen(true);
  }, []);

  const openEditModal = useCallback((manual) => {
    setEditingManual(manual);
    setSelectedFile({
      id: manual.fileId,
      fileName: manual.fileName,
      fileUrl: manual.fileUrl,
    });
    setManualTitle(manual.title || manual.fileName || "");
    setManualSku(manual.sku || "");
    setManualSeries(manual.productSeries || "");
    setModalOpen(true);
  }, []);

  const selectFile = useCallback((file) => {
    setSelectedFile(file);
    setManualTitle((current) => current || file.fileName || "");
  }, []);

  const searchFiles = useCallback(() => {
    fileSearchFetcher.submit(
      {
        _action: "searchFiles",
        fileQuery: fileSearchQuery,
      },
      { method: "post" },
    );
  }, [fileSearchFetcher, fileSearchQuery]);

  const pageSummary = useMemo(() => {
    if (total === 0) return "暂无手册";
    const start = (page - 1) * pageSize + 1;
    const end = Math.min(total, page * pageSize);
    return `展示 ${start}-${end} / 共 ${total} 个手册`;
  }, [page, pageSize, total]);
  const visibleFiles = fileSearchFetcher.data?.ok
    ? fileSearchFetcher.data.files
    : files;

  return (
    <s-page heading="用户手册" inlineSize="large">
      <s-section>
        <s-stack
          direction="inline"
          gap="base"
          alignItems="center"
          justifyContent="space-between"
        >
          <s-text tone="subdued">
            管理前台用户手册扩展页展示的文件、SKU 和产品系列。
          </s-text>
          <s-button variant="primary" onClick={openAddModal}>
            添加手册
          </s-button>
        </s-stack>
      </s-section>

      {setupError || fileError || actionData?.message ? (
        <s-section>
          {setupError ? <s-banner tone="critical">{setupError}</s-banner> : null}
          {fileError ? <s-banner tone="critical">{fileError}</s-banner> : null}
          {actionData?.message ? (
            <s-banner tone={actionData.ok ? "success" : "critical"}>
              {actionData.message}
            </s-banner>
          ) : null}
        </s-section>
      ) : null}

      <s-section heading="手册列表">
        <s-box paddingBlockEnd="base">
          <s-stack
            direction="inline"
            gap="base"
            alignItems="center"
            justifyContent="space-between"
          >
            <s-text tone="subdued">{pageSummary}</s-text>
            <s-stack direction="inline" gap="small">
              {page > 1 ? (
                <s-link href={`/app/manuals?page=${page - 1}`}>上一页</s-link>
              ) : null}
              {page < totalPages ? (
                <s-link href={`/app/manuals?page=${page + 1}`}>下一页</s-link>
              ) : null}
            </s-stack>
          </s-stack>
        </s-box>
        {manuals.length === 0 ? (
          <s-paragraph tone="subdued">暂无用户手册，点击添加手册开始配置。</s-paragraph>
        ) : (
          <s-table variant="table" paginate={false}>
            <s-table-header-row>
              <s-table-header listSlot="primary">标题</s-table-header>
              <s-table-header>SKU</s-table-header>
              <s-table-header>产品系列</s-table-header>
              <s-table-header>创建时间</s-table-header>
              <s-table-header>操作</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {manuals.map((manual) => (
                <s-table-row key={manual.id}>
                  <s-table-cell>
                    <s-link href={manual.fileUrl} target="_blank">
                      {manual.title || manual.fileName}
                    </s-link>
                  </s-table-cell>
                  <s-table-cell>{manual.sku}</s-table-cell>
                  <s-table-cell>{manual.productSeries}</s-table-cell>
                  <s-table-cell>
                    {new Date(manual.createdAt).toLocaleString("zh-CN")}
                  </s-table-cell>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small">
                      <s-button
                        type="button"
                        variant="secondary"
                        onClick={() => openEditModal(manual)}
                      >
                        编辑
                      </s-button>
                      <Form method="post">
                        <input type="hidden" name="_action" value="delete" />
                        <input type="hidden" name="id" value={manual.id} />
                        <s-button
                          type="submit"
                          variant="secondary"
                          tone="critical"
                          disabled={isSubmitting}
                        >
                          删除
                        </s-button>
                      </Form>
                    </s-stack>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      {modalOpen ? (
        <div style={modalBackdropStyle}>
          <div style={modalStyle} role="dialog" aria-modal="true">
            <s-section heading={editingManual ? "编辑手册" : "添加手册"}>
              {createFetcher.data?.ok === false ? (
                <s-box paddingBlockEnd="base">
                  <s-banner tone="critical">
                    {createFetcher.data.message || "保存失败"}
                  </s-banner>
                </s-box>
              ) : null}
              <createFetcher.Form method="post">
                <input
                  type="hidden"
                  name="_action"
                  value={editingManual ? "update" : "create"}
                />
                <input type="hidden" name="id" value={editingManual?.id || ""} />
                <input
                  type="hidden"
                  name="fileName"
                  value={selectedFileName}
                />
                <input type="hidden" name="fileId" value={selectedFileId} />
                <input type="hidden" name="fileUrl" value={selectedFileUrl} />
                <div style={formGridStyle}>
                  <s-text-field
                    label="标题"
                    name="title"
                    value={manualTitle}
                    onInput={(event) =>
                      setManualTitle(event.currentTarget.value)
                    }
                    placeholder="例如：OneGo Backpack User Manual"
                  />
                  <s-text-field
                    label="SKU"
                    name="sku"
                    value={manualSku}
                    onInput={(event) =>
                      setManualSku(event.currentTarget.value)
                    }
                    placeholder="多个 SKU 可用逗号或换行分隔"
                  />
                  <s-select
                    label="产品系列"
                    name="productSeries"
                    value={manualSeries}
                    onChange={(event) =>
                      setManualSeries(event.currentTarget.value)
                    }
                  >
                    <s-option value="">请选择产品系列</s-option>
                    {productSeries.map((series) => (
                      <s-option key={series} value={series}>
                        {series}
                      </s-option>
                    ))}
                  </s-select>

                  <div style={filePickerBoxStyle}>
                    <s-stack gap="small">
                      <s-text type="strong">从 Shopify Files 选择文件</s-text>
                      <s-text tone="subdued">
                        当前选择：{selectedFileName || "未选择"}
                      </s-text>
                      <s-text-field
                        label="搜索文件"
                        value={fileSearchQuery}
                        onInput={(event) =>
                          setFileSearchQuery(event.currentTarget.value)
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            searchFiles();
                          }
                        }}
                        placeholder="文件名或关键词"
                      />
                      <s-button
                        type="button"
                        variant="secondary"
                        loading={isSearchingFiles}
                        disabled={isSearchingFiles}
                        onClick={searchFiles}
                      >
                        {isSearchingFiles ? "搜索中..." : "搜索文件"}
                      </s-button>
                      <div style={fileListStyle}>
                        {visibleFiles.length === 0 ? (
                          <s-text tone="subdued">没有可选择的文件。</s-text>
                        ) : (
                          visibleFiles.map((file) => (
                            <button
                              key={file.id}
                              type="button"
                              onClick={() => selectFile(file)}
                              style={{
                                ...fileButtonStyle,
                                ...(selectedFileId === file.id
                                  ? selectedFileButtonStyle
                                  : {}),
                              }}
                            >
                              <span style={fileButtonNameStyle}>
                                {file.fileName}
                              </span>
                              <span style={fileButtonMetaStyle}>
                                {file.mimeType || file.fileStatus || "File"}
                              </span>
                            </button>
                          ))
                        )}
                      </div>
                    </s-stack>
                  </div>

                  <s-stack direction="inline" gap="small">
                    <s-button
                      type="submit"
                      variant="primary"
                      loading={isSavingManual}
                      disabled={isSavingManual || !selectedFileId}
                    >
                      {isSavingManual
                        ? "保存中..."
                        : editingManual
                          ? "保存修改"
                          : "保存手册"}
                    </s-button>
                    <s-button
                      type="button"
                      variant="secondary"
                      disabled={isSavingManual}
                      onClick={() => {
                        setModalOpen(false);
                        setEditingManual(null);
                      }}
                    >
                      取消
                    </s-button>
                  </s-stack>
                </div>
              </createFetcher.Form>
            </s-section>
          </div>
        </div>
      ) : null}
    </s-page>
  );
}

const modalBackdropStyle = {
  position: "fixed",
  inset: 0,
  zIndex: 100,
  display: "grid",
  placeItems: "center",
  padding: "24px",
  background: "rgba(0, 0, 0, 0.42)",
};

const modalStyle = {
  width: "min(760px, calc(100vw - 48px))",
  maxHeight: "calc(100vh - 48px)",
  overflow: "auto",
  borderRadius: "8px",
  background: "#ffffff",
};

const formGridStyle = {
  display: "grid",
  gap: "16px",
};

const filePickerBoxStyle = {
  border: "1px solid #d4d4d4",
  borderRadius: "8px",
  padding: "14px",
  background: "#fbfbfb",
};

const fileListStyle = {
  display: "grid",
  gap: "8px",
  maxHeight: "260px",
  overflow: "auto",
};

const fileButtonStyle = {
  display: "grid",
  gap: "4px",
  width: "100%",
  padding: "10px 12px",
  border: "1px solid #d4d4d4",
  borderRadius: "8px",
  background: "#ffffff",
  color: "#202223",
  cursor: "pointer",
  textAlign: "left",
};

const selectedFileButtonStyle = {
  borderColor: "#1f1f1f",
  background: "#f1f1f1",
};

const fileButtonNameStyle = {
  fontWeight: 650,
};

const fileButtonMetaStyle = {
  color: "#616161",
  fontSize: "12px",
};

export const headers = (headersArgs) => boundary.headers(headersArgs);
