/**
 * FAQ 组：Shopify Metaobject 类型 `faq_group`（可用环境变量覆盖，例如 `$app:faq_group`）。
 * 字段：faq-title、faq-question-list（json）
 */

/** @returns {string} GraphQL metaobjects(type: ...) 参数 */
export function getFaqGroupMetaobjectType() {
  return process.env.FAQ_GROUP_METAOBJECT_TYPE ?? "faq_group";
}

export const FAQ_TITLE_KEY = "faq-title";
export const FAQ_QUESTION_LIST_KEY = "faq-question-list";

/** 与后台定义 key 不一致时的备选（如 faq_title） */
export const FAQ_TITLE_KEY_CANDIDATES = [
  FAQ_TITLE_KEY,
  "faq_title",
  "faqTitle",
];

export const FAQ_QUESTION_LIST_KEY_CANDIDATES = [
  FAQ_QUESTION_LIST_KEY,
  "faq_question_list",
  "faqQuestionList",
];

/**
 * 从 metaobject.fields 中按 key 候选顺序取文本值（优先 value，其次 jsonValue）。
 * @param {{ key: string; value?: string | null; jsonValue?: unknown }[] | null | undefined} fields
 * @param {string[]} keyCandidates
 * @returns {string}
 */
/**
 * 在已有 fields 中解析实际使用的 key（用于 metaobjectUpdate 写回原字段）。
 * @param {{ key: string }[] | null | undefined} fields
 * @param {string[]} keyCandidates
 * @returns {string}
 */
export function resolveMetaobjectFieldKey(fields, keyCandidates) {
  if (!fields?.length) return keyCandidates[0];
  const keys = new Set(fields.map((f) => f.key));
  for (const c of keyCandidates) {
    if (keys.has(c)) return c;
  }
  return keyCandidates[0];
}

export function pickMetaobjectFieldValue(fields, keyCandidates) {
  if (!fields?.length) return "";
  const byKey = new Map(fields.map((f) => [f.key, f]));
  for (const key of keyCandidates) {
    const f = byKey.get(key);
    if (!f) continue;
    const raw = f.value;
    if (raw != null && String(raw).trim() !== "") {
      return String(raw);
    }
    const j = f.jsonValue;
    if (j == null) continue;
    if (typeof j === "string" && j.trim() !== "") return j;
    if (typeof j === "object") {
      try {
        return JSON.stringify(j);
      } catch {
        continue;
      }
    }
  }
  return "";
}

/**
 * @param {string | null | undefined} raw
 * @returns {{ list: { question: string; answer: string }[] }}
 */
export function parseFaqQuestionList(raw) {
  if (!raw || typeof raw !== "string") {
    return { list: [] };
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.list)) {
      return { list: [] };
    }
    return {
      list: parsed.list.map((item) => ({
        question: typeof item?.question === "string" ? item.question : "",
        answer: typeof item?.answer === "string" ? item.answer : "",
      })),
    };
  } catch {
    return { list: [] };
  }
}

/**
 * @param {{ list: { question: string; answer: string }[] }} data
 * @returns {string}
 */
export function stringifyFaqQuestionList(data) {
  return JSON.stringify({ list: data.list ?? [] });
}

/**
 * @param {string} param URL 段：数字 ID 或已编码的 gid
 * @returns {string} Metaobject GID
 */
export function metaobjectGidFromRouteParam(param) {
  const decoded = decodeURIComponent(param);
  if (decoded.startsWith("gid://")) {
    return decoded;
  }
  return `gid://shopify/Metaobject/${decoded}`;
}

/**
 * @param {string} gid
 * @returns {string} 用于 URL 的数字 ID
 */
export function metaobjectNumericIdFromGid(gid) {
  const id = gid.split("/").pop();
  return id ?? gid;
}

/**
 * 将 metaobject.referencedBy 整理为「哪些商品引用了该条目」等展示文案。
 * @param {{ edges?: { node?: { referencer?: { __typename?: string; title?: string } } }[]; pageInfo?: { hasNextPage?: boolean } } | null | undefined} referencedBy
 * @returns {string}
 */
export function summarizeReferencedByProducts(referencedBy) {
  const edges = referencedBy?.edges ?? [];
  const titles = [];
  for (const { node } of edges) {
    const r = node?.referencer;
    if (r?.__typename === "Product") {
      const t = typeof r.title === "string" ? r.title.trim() : "";
      const idShort =
        typeof r.id === "string" ? r.id.split("/").pop() : undefined;
      if (t) titles.push(t);
      else if (idShort) titles.push(`商品 #${idShort}`);
    }
  }
  const uniq = [...new Set(titles)];
  let text =
    uniq.length > 0
      ? uniq.join("、")
      : edges.length > 0
        ? `其他资源引用 ${edges.length} 处（非 Product）`
        : "—";
  if (referencedBy?.pageInfo?.hasNextPage) {
    text += " …";
  }
  return text;
}

/**
 * 编辑页：按 Product 拆成标签（按 id 去重），便于 s-badge 展示。
 * @param {{ edges?: { node?: { referencer?: { __typename?: string; id?: string; title?: string } } }[]; pageInfo?: { hasNextPage?: boolean } } | null | undefined} referencedBy
 * @returns {{ tags: { id: string; label: string }[]; fallbackLabel: string | null; hasMore: boolean }}
 */
export function getReferencedProductBadges(referencedBy) {
  const edges = referencedBy?.edges ?? [];
  /** @type {Map<string, { id: string; label: string }>} */
  const byId = new Map();
  for (const { node } of edges) {
    const r = node?.referencer;
    if (r?.__typename !== "Product" || typeof r.id !== "string") continue;
    const t = typeof r.title === "string" ? r.title.trim() : "";
    const shortId = r.id.split("/").pop() ?? r.id;
    const label = t || `商品 #${shortId}`;
    if (!byId.has(r.id)) byId.set(r.id, { id: r.id, label });
  }
  const tags = [...byId.values()];
  const hasMore = Boolean(referencedBy?.pageInfo?.hasNextPage);
  let fallbackLabel = null;
  if (tags.length === 0) {
    fallbackLabel =
      edges.length > 0
        ? `其他引用 ${edges.length} 处（非 Product）`
        : "暂无商品引用";
  }
  return { tags, fallbackLabel, hasMore };
}
