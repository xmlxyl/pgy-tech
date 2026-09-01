import prisma from "../db.server";
import {
  MANUAL_PRODUCT_SERIES,
  buildManualWhere,
  hasManualModel,
  isMissingManualTableError,
  resolveManualProxyShop,
  serializeManual,
} from "../lib/manuals.server";

export const loader = async ({ request }) => {
  const auth = await resolveManualProxyShop(request);
  if (!auth.ok) {
    return html(renderError(auth.message), 200);
  }

  if (!hasManualModel()) {
    return html(renderError("Manuals are temporarily unavailable."), 200);
  }

  const url = new URL(request.url);
  const query = url.searchParams.get("q") || "";

  let manuals = [];
  try {
    manuals = await prisma.userManual.findMany({
      where: buildManualWhere(auth.shop, { query }),
      orderBy: [{ productSeries: "asc" }, { title: "asc" }, { fileName: "asc" }],
      take: 200,
    });
  } catch (error) {
    if (!isMissingManualTableError(error)) throw error;
    return html(renderError("Manuals are temporarily unavailable."), 200);
  }

  return html(
    renderPage({
      manuals: manuals.map(serializeManual),
      query,
      embedded: url.searchParams.get("embedded") === "1",
      path: new URL(request.url).pathname,
    }),
  );
};

function renderPage({ manuals, query, embedded, path }) {
  const normalizedQuery = query.trim();
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>PGYTECH User Manuals</title>
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #111827;
        background: #f7f8fa;
      }
      .manual-page {
        width: min(100%, 1120px);
        margin: 0 auto;
        padding: 48px 24px;
      }
      .manual-title {
        margin: 0 0 24px;
        font-size: clamp(34px, 5vw, 56px);
        line-height: 1;
        font-weight: 850;
        letter-spacing: 0;
      }
      .toolbar {
        display: grid;
        gap: 18px;
        margin-bottom: 28px;
      }
      .search {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 10px;
      }
      .search input {
        width: 100%;
        min-height: 48px;
        border: 1px solid #d1d5db;
        border-radius: 8px;
        padding: 0 14px;
        color: #111827;
        background: #fff;
        font: inherit;
      }
      .search button {
        min-height: 48px;
        border: 0;
        border-radius: 8px;
        padding: 0 22px;
        color: #fff;
        background: #111827;
        font: inherit;
        font-weight: 750;
        cursor: pointer;
      }
      .categories {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }
      .category {
        display: inline-flex;
        align-items: center;
        min-height: 38px;
        border: 1px solid #d1d5db;
        border-radius: 999px;
        padding: 0 14px;
        color: #374151;
        background: #fff;
        font-size: 14px;
        font-weight: 720;
        text-decoration: none;
        cursor: pointer;
      }
      .category.is-active {
        border-color: #111827;
        color: #fff;
        background: #111827;
      }
      .manual-list {
        display: grid;
        gap: 10px;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .manual-item {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto auto;
        gap: 16px;
        align-items: center;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        padding: 18px 20px;
        background: #fff;
      }
      .manual-item[hidden] {
        display: none;
      }
      .manual-main {
        min-width: 0;
      }
      .manual-name {
        display: block;
        color: #111827;
        font-size: 17px;
        font-weight: 800;
        line-height: 1.35;
        text-decoration: none;
        overflow-wrap: anywhere;
      }
      .manual-sku {
        display: block;
        margin-top: 6px;
        color: #6b7280;
        font-size: 14px;
        line-height: 1.4;
        overflow-wrap: anywhere;
      }
      .manual-series {
        display: inline-flex;
        align-items: center;
        min-height: 32px;
        border-radius: 999px;
        padding: 0 12px;
        color: #1f2937;
        background: #eef2f7;
        font-size: 13px;
        font-weight: 750;
        white-space: nowrap;
      }
      .download {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 38px;
        border-radius: 8px;
        padding: 0 14px;
        color: #fff;
        background: #2f5bff;
        font-size: 14px;
        font-weight: 800;
        text-decoration: none;
        white-space: nowrap;
      }
      mark {
        border-radius: 4px;
        padding: 0 2px;
        color: inherit;
        background: #fff2a8;
      }
      .empty {
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        padding: 24px;
        color: #6b7280;
        background: #fff;
      }
      body.is-embedded {
        background: transparent;
      }
      body.is-embedded .manual-page {
        padding-top: 32px;
        padding-bottom: 32px;
      }
      @media (max-width: 680px) {
        .manual-page {
          padding: 34px 16px;
        }
        .search {
          grid-template-columns: 1fr;
        }
        .manual-item {
          grid-template-columns: 1fr;
          align-items: start;
          padding: 16px;
        }
        .download {
          width: 100%;
        }
      }
    </style>
  </head>
  <body class="${embedded ? "is-embedded" : ""}">
    <main class="manual-page">
      <h1 class="manual-title">User Manuals</h1>
      <div class="toolbar">
        <form class="search" method="get" action="${escapeHtml(path)}">
          <input type="search" name="q" value="${escapeHtml(query)}" placeholder="Search by title, file name, or SKU" aria-label="Search manuals">
          <input type="hidden" name="embedded" value="${embedded ? "1" : "0"}">
          <button type="submit">Search</button>
        </form>
        <nav class="categories" aria-label="Manual categories">
          ${renderCategoryButton("All", "")}
          ${MANUAL_PRODUCT_SERIES
            .map((item) => renderCategoryButton(item, categoryKey(item)))
            .join("")}
        </nav>
      </div>
      ${
        manuals.length
          ? `<ul class="manual-list">${manuals
              .map((manual) => renderManualItem(manual, normalizedQuery))
              .join("")}</ul>`
          : `<div class="empty">No manuals found.</div>`
      }
      <div class="empty" data-filter-empty hidden>No manuals found in this category.</div>
    </main>
    <script>
      (function () {
        var buttons = Array.prototype.slice.call(document.querySelectorAll("[data-category-button]"));
        var items = Array.prototype.slice.call(document.querySelectorAll("[data-manual-category]"));
        var empty = document.querySelector("[data-filter-empty]");
        if (!buttons.length || !items.length) return;

        buttons.forEach(function (button) {
          button.addEventListener("click", function () {
            var category = button.getAttribute("data-category-button") || "";
            var visibleCount = 0;

            buttons.forEach(function (item) {
              item.classList.toggle("is-active", item === button);
            });

            items.forEach(function (item) {
              var shouldShow = !category || item.getAttribute("data-manual-category") === category;
              item.hidden = !shouldShow;
              if (shouldShow) visibleCount += 1;
            });

            if (empty) empty.hidden = visibleCount > 0;
          });
        });
      })();
    </script>
  </body>
</html>`;
}

function renderCategoryButton(label, value) {
  return `<button class="category ${value ? "" : "is-active"}" type="button" data-category-button="${escapeHtml(value)}">${escapeHtml(label)}</button>`;
}

function renderManualItem(manual, query) {
  const titleHtml = highlightText(manual.title || manual.fileName, query);
  const skuHtml = `SKU: ${highlightText(orderSkuList(manual.sku, query), query)}`;

  return `<li class="manual-item" data-manual-category="${escapeHtml(categoryKey(manual.productSeries))}">
    <div class="manual-main">
      <a class="manual-name" href="${escapeHtml(manual.fileUrl)}" target="_blank" rel="noopener">${titleHtml}</a>
      <span class="manual-sku">${skuHtml}</span>
    </div>
    <span class="manual-series">${escapeHtml(manual.productSeries)}</span>
    <a class="download" href="${escapeHtml(manual.fileUrl)}" target="_blank" rel="noopener">Download</a>
  </li>`;
}

function categoryKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function orderSkuList(value, query) {
  const text = String(value ?? "").trim();
  const needle = String(query || "").trim().toLowerCase();
  if (!text || !needle) return text;

  const skus = text
    .split(/[,，、;；\n]+/)
    .map((sku) => sku.trim())
    .filter(Boolean);
  if (skus.length <= 1) return text;

  const exactMatches = [];
  const partialMatches = [];
  const others = [];
  for (const sku of skus) {
    const key = sku.toLowerCase();
    if (key === needle) {
      exactMatches.push(sku);
    } else if (key.includes(needle)) {
      partialMatches.push(sku);
    } else {
      others.push(sku);
    }
  }

  if (exactMatches.length === 0 && partialMatches.length === 0) return text;
  return [...exactMatches, ...partialMatches, ...others].join("、");
}

function highlightText(value, query) {
  const text = String(value ?? "");
  const needle = String(query || "").trim();
  if (!needle) return escapeHtml(text);

  const lowerText = text.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  let index = 0;
  let output = "";
  while (index < text.length) {
    const matchIndex = lowerText.indexOf(lowerNeedle, index);
    if (matchIndex === -1) {
      output += escapeHtml(text.slice(index));
      break;
    }
    output += escapeHtml(text.slice(index, matchIndex));
    output += `<mark>${escapeHtml(text.slice(matchIndex, matchIndex + needle.length))}</mark>`;
    index = matchIndex + needle.length;
  }
  return output;
}

function renderError(message) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>PGYTECH User Manuals</title>
    <style>
      body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #f7f8fa; color: #111827; }
      .error { width: min(100%, 720px); margin: 48px auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 8px; background: #fff; }
    </style>
  </head>
  <body><main class="error"><h1>User Manuals</h1><p>${escapeHtml(message)}</p></main></body>
</html>`;
}

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
