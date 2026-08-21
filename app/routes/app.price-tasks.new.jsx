/* eslint-disable react/prop-types */
import {
  Form,
  redirect,
  useActionData,
  useNavigation,
  useSubmit,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  createPriceTask,
  enrichRowsWithShopifyVariants,
  parsePriceTaskExcel,
} from "../lib/price-tasks.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("_action") || "preview");
  const form = getSubmittedForm(formData);
  const name = String(formData.get("name") || "").trim();
  const errors = [];

  if (intent === "confirm") {
    const rows = parseRowsJson(formData, errors);

    if (!name) errors.push("任务名称不能为空");
    if (rows.length === 0) {
      errors.push("没有可创建的 SKU 数据，请重新上传 Excel");
    }
    if (rows.some((row) => row.errors?.length > 0)) {
      errors.push("存在校验失败的 SKU，请修正 Excel 后重新上传");
    }
    if (errors.length) {
      return { mode: "preview", ok: false, errors, rows, form };
    }

    await createPriceTask({
      shop: session.shop,
      createdBy: session.email || session.shop,
      name,
      fileName: String(formData.get("fileName") || "price-task.xlsx"),
      rows,
    });

    return redirect("/app/price-tasks");
  }

  const file = formData.get("file");
  if (!(file instanceof File) || !file.name) {
    errors.push("请上传 Excel 文件");
  } else if (!/\.(xlsx|xls)$/i.test(file.name)) {
    errors.push("仅支持 .xlsx 或 .xls 文件");
  }

  if (errors.length) {
    return { mode: "form", ok: false, errors, rows: [], form };
  }

  const parsed = await parsePriceTaskExcel(file);
  const enriched = await enrichRowsWithShopifyVariants(admin, parsed.rows);
  const allErrors = [...parsed.errors, ...enriched.errors];

  if (enriched.rows.length === 0) {
    allErrors.push("Excel 中没有可读取的 SKU 数据");
  }

  const hasInvalidRow = enriched.rows.some((row) => row.errors.length > 0);

  return {
    mode: "preview",
    ok: allErrors.length === 0 && !hasInvalidRow,
    errors: allErrors,
    rows: enriched.rows,
    fileName: file.name,
    form,
  };
};

export default function NewPriceTaskPage() {
  const actionData = useActionData();
  const navigation = useNavigation();
  const submit = useSubmit();
  const isSubmitting = navigation.state === "submitting";
  const rows = actionData?.rows || [];
  const form = actionData?.form || {};
  const rowsAreValid =
    rows.length > 0 && rows.every((row) => !row.errors?.length);

  const handleFileChange = (event) => {
    const formElement = event.currentTarget.form;
    if (!event.currentTarget.files?.length || !formElement) return;

    const formData = new FormData(formElement);
    formData.set("_action", "preview");
    submit(formData, {
      method: "post",
      encType: "multipart/form-data",
    });
  };

  return (
    <s-page heading="新建划线价修改任务" inlineSize="large">
      <div style={pageWrapStyle}>
        <s-section heading="任务信息">
          {actionData?.errors?.length ? (
            <s-banner tone="critical">
              <s-unordered-list>
                {actionData.errors.slice(0, 10).map((error) => (
                  <s-list-item key={error}>{error}</s-list-item>
                ))}
              </s-unordered-list>
            </s-banner>
          ) : null}

          <Form method="post" encType="multipart/form-data">
            <input
              type="hidden"
              name="fileName"
              value={actionData?.fileName || ""}
            />
            <input type="hidden" name="rowsJson" value={JSON.stringify(rows)} />

            <div style={formBodyStyle}>
              <s-text-field
                label="任务名称"
                name="name"
                defaultValue={form.name || ""}
                placeholder="例如：8 月会员日划线价"
              />

              <div style={uploadBoxStyle}>
                <div style={uploadTitleStyle}>Excel 文件</div>
                <div style={helperTextStyle}>
                  选择文件后自动解析，下方会展示确认表格。目标价格需小于当前价格。
                </div>
                <input
                  type="file"
                  name="file"
                  accept=".xlsx,.xls"
                  onChange={handleFileChange}
                  style={fileInputStyle}
                />
              </div>

              <div style={actionRowStyle}>
                <button
                  type="submit"
                  name="_action"
                  value="confirm"
                  disabled={!rowsAreValid || isSubmitting}
                  style={{
                    ...primaryButtonStyle,
                    ...(!rowsAreValid || isSubmitting
                      ? disabledButtonStyle
                      : {}),
                  }}
                >
                  {isSubmitting &&
                  navigation.formData?.get("_action") === "confirm"
                    ? "创建中..."
                    : "确认创建任务"}
                </button>
                <s-link href="/app/price-tasks">
                  <s-button variant="secondary">返回列表</s-button>
                </s-link>
              </div>
            </div>
          </Form>
        </s-section>

        {isSubmitting && navigation.formData?.get("_action") !== "confirm" ? (
          <s-section heading="Excel 解析结果">
            <s-banner tone="info">正在解析 Excel，请稍候...</s-banner>
          </s-section>
        ) : null}

        {rows.length ? (
          <s-section heading="Excel 解析结果">
            {rowsAreValid ? (
              <s-banner tone="success">
                Excel 校验通过，请确认下方 SKU 和价格后创建任务。
              </s-banner>
            ) : (
              <s-banner tone="critical">
                Excel 存在校验失败数据，请修正文件后重新上传。
              </s-banner>
            )}

            <s-box paddingBlockStart="base">
              <s-table variant="table" paginate={false}>
                <s-table-header-row>
                  <s-table-header>行号</s-table-header>
                  <s-table-header listSlot="primary">SKU</s-table-header>
                  <s-table-header>原价</s-table-header>
                  <s-table-header>当前价格</s-table-header>
                  <s-table-header>目标价格</s-table-header>
                  <s-table-header>校验结果</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {rows.map((row) => (
                    <s-table-row key={`${row.lineNumber}-${row.sku}`}>
                      <s-table-cell>{row.lineNumber}</s-table-cell>
                      <s-table-cell>{row.sku || "-"}</s-table-cell>
                      <s-table-cell>{row.currentCompareAtPrice || "-"}</s-table-cell>
                      <s-table-cell>{row.originalPrice || "-"}</s-table-cell>
                      <s-table-cell>{row.targetPrice || "-"}</s-table-cell>
                      <s-table-cell>
                        {row.errors.length ? row.errors.join("；") : "通过"}
                      </s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
            </s-box>
          </s-section>
        ) : null}
      </div>
    </s-page>
  );
}

function parseRowsJson(formData, errors) {
  try {
    return JSON.parse(String(formData.get("rowsJson") || "[]"));
  } catch {
    errors.push("预览数据已失效，请重新上传 Excel");
    return [];
  }
}

function getSubmittedForm(formData) {
  return {
    name: String(formData.get("name") || ""),
  };
}

const pageWrapStyle = {
  width: "760px",
  maxWidth: "calc(100vw - 48px)",
  margin: "0 auto",
};

const formBodyStyle = {
  display: "flex",
  flexDirection: "column",
  gap: "1rem",
};

const uploadBoxStyle = {
  padding: "18px",
  border: "1px dashed #b5b5b5",
  borderRadius: "8px",
  background: "#fbfbfb",
};

const uploadTitleStyle = {
  marginBottom: "0.5rem",
  color: "#303030",
  fontWeight: 650,
};

const helperTextStyle = {
  marginBottom: "1rem",
  color: "#616161",
  fontSize: "0.875rem",
};

const fileInputStyle = {
  display: "block",
};

const actionRowStyle = {
  display: "flex",
  alignItems: "center",
  gap: "0.75rem",
};

const primaryButtonStyle = {
  minHeight: "2.25rem",
  padding: "0.375rem 0.875rem",
  border: "1px solid #1f1f1f",
  borderRadius: "0.5rem",
  background: "#303030",
  color: "#ffffff",
  cursor: "pointer",
  fontWeight: 650,
};

const disabledButtonStyle = {
  borderColor: "#c8c8c8",
  background: "#d4d4d4",
  color: "#ffffff",
  cursor: "not-allowed",
};

export const headers = (headersArgs) => boundary.headers(headersArgs);
