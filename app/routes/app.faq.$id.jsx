import { useEffect, useMemo, useRef, useState } from "react";
import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { FaqHtmlEditor } from "../components/FaqHtmlEditor.jsx";
import {
  FAQ_QUESTION_LIST_KEY,
  FAQ_QUESTION_LIST_KEY_CANDIDATES,
  FAQ_TITLE_KEY,
  FAQ_TITLE_KEY_CANDIDATES,
  getFaqGroupMetaobjectType,
  metaobjectGidFromRouteParam,
  parseFaqQuestionList,
  pickMetaobjectFieldValue,
  resolveMetaobjectFieldKey,
  stringifyFaqQuestionList,
  getReferencedProductBadges,
} from "../lib/faq-metafields";

/** @param {{ params: Record<string, string | undefined> }} args */
export const loader = async ({ request, params }) => {
  const { admin } = await authenticate.admin(request);
  const rawId = params.id;
  if (!rawId) {
    throw redirect("/app/faq");
  }

  const metaobjectId = metaobjectGidFromRouteParam(rawId);

  const response = await admin.graphql(
    `#graphql
      query FaqGroupOne($id: ID!) {
        metaobject(id: $id) {
          id
          handle
          displayName
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
      }`,
    { variables: { id: metaobjectId } },
  );

  const json = await response.json();
  const entry = json.data?.metaobject;
  if (!entry) {
    const msg = json.errors?.[0]?.message ?? "未找到该 FAQ 组或无权访问。";
    throw new Response(msg, { status: 404 });
  }

  const faqTitleRaw = pickMetaobjectFieldValue(
    entry.fields,
    FAQ_TITLE_KEY_CANDIDATES,
  );
  const faqTitle = faqTitleRaw.trim();
  const faqListRaw = pickMetaobjectFieldValue(
    entry.fields,
    FAQ_QUESTION_LIST_KEY_CANDIDATES,
  );
  const faqData = parseFaqQuestionList(faqListRaw);
  const referencedProducts = getReferencedProductBadges(entry.referencedBy);
  const persistTitleKey = resolveMetaobjectFieldKey(
    entry.fields,
    FAQ_TITLE_KEY_CANDIDATES,
  );
  const persistListKey = resolveMetaobjectFieldKey(
    entry.fields,
    FAQ_QUESTION_LIST_KEY_CANDIDATES,
  );

  return {
    metaobjectId: entry.id,
    metaobjectType: getFaqGroupMetaobjectType(),
    handle: entry.handle,
    displayName: entry.displayName ?? "",
    referencedProductTags: referencedProducts.tags,
    referencedByFallback: referencedProducts.fallbackLabel,
    referencedByHasMore: referencedProducts.hasMore,
    persistTitleKey,
    persistListKey,
    faqTitle,
    faqList: faqData.list,
  };
};

/** @param {{ request: Request; params: Record<string, string | undefined> }} args */
export const action = async ({ request, params }) => {
  const { admin } = await authenticate.admin(request);
  const rawId = params.id;
  if (!rawId) {
    return { ok: false, error: "缺少条目 ID" };
  }

  const form = await request.formData();
  const intent = form.get("intent");
  if (intent !== "save") {
    return { ok: false, error: "无效操作" };
  }

  const faqTitle = String(form.get("faqTitle") ?? "").trim();
  let list;
  try {
    const rawList = form.get("faqListJson");
    const parsed =
      typeof rawList === "string" ? JSON.parse(rawList) : { list: [] };
    if (!parsed || !Array.isArray(parsed.list)) {
      return { ok: false, error: "问答列表格式无效" };
    }
    list = parsed.list.map((item) => ({
      question: String(item?.question ?? ""),
      answer: String(item?.answer ?? ""),
    }));
  } catch {
    return { ok: false, error: "问答列表 JSON 无法解析" };
  }

  const metaobjectId = metaobjectGidFromRouteParam(rawId);
  const listJson = stringifyFaqQuestionList({ list });

  const titleFieldKey = String(
    form.get("persistTitleKey") ?? FAQ_TITLE_KEY,
  ).trim();
  const listFieldKey = String(
    form.get("persistListKey") ?? FAQ_QUESTION_LIST_KEY,
  ).trim();

  const mutation = await admin.graphql(
    `#graphql
      mutation FaqGroupMetaobjectUpdate($id: ID!, $metaobject: MetaobjectUpdateInput!) {
        metaobjectUpdate(id: $id, metaobject: $metaobject) {
          metaobject {
            id
            handle
          }
          userErrors {
            field
            message
          }
        }
      }`,
    {
      variables: {
        id: metaobjectId,
        metaobject: {
          fields: [
            { key: titleFieldKey, value: faqTitle },
            { key: listFieldKey, value: listJson },
          ],
        },
      },
    },
  );

  const json = await mutation.json();
  const userErrors = json.data?.metaobjectUpdate?.userErrors ?? [];
  if (userErrors.length > 0) {
    return {
      ok: false,
      error: userErrors.map((e) => e.message).join("；"),
    };
  }
  if (json.errors?.length) {
    return { ok: false, error: json.errors.map((e) => e.message).join("；") };
  }

  return { ok: true, error: null };
};

function nextRowKey() {
  return `k-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** @param {{ question: string; answer: string }[]} list */
function initItems(list) {
  if (!list?.length) return [];
  return list.map((row) => ({
    question: row.question ?? "",
    answer: row.answer ?? "",
    _key: nextRowKey(),
  }));
}

/** @param {{ _key: string }[]} rows */
function allRowKeysCollapsed(rows) {
  return new Set(rows.map((r) => r._key));
}

export default function FaqGroupEdit() {
  const loaderData = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const shopify = useAppBridge();

  const [faqTitle, setFaqTitle] = useState(loaderData.faqTitle);

  const bootRef = useRef(null);
  if (bootRef.current === null) {
    const rows = initItems(loaderData.faqList);
    bootRef.current = {
      items: rows,
      collapsedKeys: allRowKeysCollapsed(rows),
    };
  }

  const [items, setItems] = useState(bootRef.current.items);
  /** 折叠中的条目 _key（默认全部折叠） */
  const [collapsedKeys, setCollapsedKeys] = useState(
    bootRef.current.collapsedKeys,
  );

  useEffect(() => {
    setFaqTitle(loaderData.faqTitle);
    const nextItems = initItems(loaderData.faqList);
    setItems(nextItems);
    setCollapsedKeys(allRowKeysCollapsed(nextItems));
  }, [loaderData.metaobjectId]); // eslint-disable-line react-hooks/exhaustive-deps -- reset only when switching entries

  const faqListJson = useMemo(
    () =>
      JSON.stringify({
        list: items.map(({ question, answer }) => ({ question, answer })),
      }),
    [items],
  );

  useEffect(() => {
    if (actionData?.ok) {
      shopify.toast.show("已保存");
    } else if (actionData?.error) {
      shopify.toast.show(actionData.error, { isError: true });
    }
  }, [actionData, shopify]);

  const saving =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "save";

  const addRow = () => {
    const key = nextRowKey();
    setItems((prev) => [...prev, { question: "", answer: "", _key: key }]);
    setCollapsedKeys((prev) => new Set(prev).add(key));
  };

  const removeRow = (key) => {
    setItems((prev) => prev.filter((row) => row._key !== key));
    setCollapsedKeys((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  };

  const updateRow = (key, field, value) => {
    setItems((prev) =>
      prev.map((row) =>
        row._key === key ? { ...row, [field]: value } : row,
      ),
    );
  };

  const moveRow = (key, delta) => {
    setItems((prev) => {
      const i = prev.findIndex((r) => r._key === key);
      if (i < 0) return prev;
      const j = i + delta;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const toggleCollapsed = (key) => {
    setCollapsedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <s-page
      heading="编辑 FAQ"
      inlineSize="large"
      breadcrumbActions={<Link to="/app/faq">FAQ 列表</Link>}
    >
      <s-section>
        <s-stack direction="block" gap="small-100">
          <s-text type="strong">引用产品（referencedBy）</s-text>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "0.5rem",
              alignItems: "center",
              marginBlockEnd: "1rem",
            }}
          >
            {loaderData.referencedProductTags.map((p) => (
              <s-badge key={p.id} tone="info" color="strong">
                {p.label}
              </s-badge>
            ))}
            {loaderData.referencedByFallback ? (
              <s-badge tone="neutral" color="strong">
                {loaderData.referencedByFallback}
              </s-badge>
            ) : null}
            {loaderData.referencedByHasMore ? (
              <s-badge tone="caution">… 还有更多引用</s-badge>
            ) : null}
          </div>
        </s-stack>
        {loaderData.displayName ? (
          <s-paragraph tone="subdued">
            displayName：{loaderData.displayName}
          </s-paragraph>
        ) : null}
        <s-paragraph tone="subdued">
          handle：<code>{loaderData.handle}</code>
        </s-paragraph>
      </s-section>

      <Form method="post">
        <input type="hidden" name="intent" value="save" />
        <input type="hidden" name="persistTitleKey" value={loaderData.persistTitleKey} />
        <input type="hidden" name="persistListKey" value={loaderData.persistListKey} />
        <input type="hidden" name="faqTitle" value={faqTitle} />
        <input type="hidden" name="faqListJson" value={faqListJson} />

        <div style={{ marginBlockEnd: "1.5rem" }}>
          <s-section heading="FAQ 标题">
            <s-text-field
              label={`${FAQ_TITLE_KEY}`}
              value={faqTitle}
              onChange={(e) => setFaqTitle(e.currentTarget.value)}
              autocomplete="off"
            />
          </s-section>
        </div>

        <s-section heading="FAQ列表">
          {items.length === 0 ? (
            <s-paragraph tone="subdued">
              当前没有问答条目，可点击下方「添加问答」。
            </s-paragraph>
          ) : (
            <s-stack direction="block" gap="large">
              {items.map((row, index) => {
                const collapsed = collapsedKeys.has(row._key);
                const q = row.question.trim();
                let previewLine = "";
                if (q) {
                  previewLine = q.length > 120 ? `${q.slice(0, 120)}…` : q;
                } else {
                  const plain = row.answer.replace(/<[^>]+>/g, "").trim();
                  previewLine =
                    plain.length > 80
                      ? `${plain.slice(0, 80)}…`
                      : plain || "（无预览）";
                }
                return (
                  <s-box
                    key={row._key}
                    padding="base"
                    borderWidth="base"
                    borderRadius="base"
                    background="subdued"
                  >
                    <s-stack direction="block" gap="base">
                      <s-stack
                        direction="inline"
                        gap="base"
                        alignItems="center"
                      >
                        <s-heading>第 {index + 1} 条</s-heading>
                        <s-button
                          type="button"
                          variant="tertiary"
                          onClick={() => toggleCollapsed(row._key)}
                        >
                          {collapsed ? "展开" : "折叠"}
                        </s-button>
                        <s-button
                          type="button"
                          variant="tertiary"
                          onClick={() => moveRow(row._key, -1)}
                          disabled={index === 0}
                        >
                          上移
                        </s-button>
                        <s-button
                          type="button"
                          variant="tertiary"
                          onClick={() => moveRow(row._key, 1)}
                          disabled={index === items.length - 1}
                        >
                          下移
                        </s-button>
                        <s-button
                          type="button"
                          variant="tertiary"
                          tone="critical"
                          onClick={() => removeRow(row._key)}
                        >
                          删除
                        </s-button>
                      </s-stack>
                      {collapsed ? (
                        <s-paragraph tone="subdued">{previewLine}</s-paragraph>
                      ) : (
                        <>
                          <s-text-field
                            label="问题 question"
                            value={row.question}
                            onChange={(e) =>
                              updateRow(
                                row._key,
                                "question",
                                e.currentTarget.value,
                              )
                            }
                            autocomplete="off"
                          />
                          <FaqHtmlEditor
                            label="答案 answer（富文本 HTML）"
                            value={row.answer}
                            onChange={(html) =>
                              updateRow(row._key, "answer", html)
                            }
                            placeholder="在此编辑答案，将保存为 HTML"
                          />
                        </>
                      )}
                    </s-stack>
                  </s-box>
                );
              })}
            </s-stack>
          )}
          <s-stack direction="inline" gap="base" paddingBlockStart="base">
            <s-button type="button" variant="secondary" onClick={addRow}>
              添加问答
            </s-button>
            <s-button
              type="submit"
              variant="primary"
              {...(saving ? { loading: true } : {})}
            >
              保存
            </s-button>
          </s-stack>
        </s-section>
      </Form>

      <s-section slot="aside" heading="说明">
        <s-paragraph tone="subdued">
          Metaobject 类型 <code>{loaderData.metaobjectType}</code>，字段{" "}
          <code>{FAQ_TITLE_KEY}</code>、<code>{FAQ_QUESTION_LIST_KEY}</code>
          。保存时调用 <code>metaobjectUpdate</code> 写回原条目。
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
