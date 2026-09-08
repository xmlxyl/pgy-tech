import { readFileSync } from "fs";
import { join } from "path";
import prisma from "../db.server";
import {
  MANUAL_PRODUCT_SERIES,
  buildManualWhere,
  hasManualModel,
  isMissingManualTableError,
  resolveManualProxyShop,
  serializeManual,
} from "../lib/manuals.server";

const DEFAULT_PDF_ICON = (() => {
  try {
    const bytes = readFileSync(join(process.cwd(), "public/images/pdf-icon.jpg"));
    return `data:image/jpeg;base64,${bytes.toString("base64")}`;
  } catch {
    return "";
  }
})();

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
  const pdfIcon = url.searchParams.get("pdfIcon") || DEFAULT_PDF_ICON;

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
      pdfIcon,
    }),
  );
};

function renderPage({ manuals, query, embedded, path, pdfIcon }) {
  const normalizedQuery = query.trim();
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>PGYTECH User Manuals</title>
    <style>
      * { box-sizing: border-box; }
      html, body {
        margin: 0;
        height: auto;
        min-height: 0;
        overflow: hidden;
      }
      body {
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #111827;
        background: #f7f8fa;
      }
      .manual-page {
        width: min(100%, 1120px);
        margin: 0 auto;
        padding: 48px 24px 24px;
      }
      .manual-header {
        margin-bottom: 28px;
      }
      .manual-title {
        margin: 0;
        font-size: clamp(34px, 5vw, 52px);
        line-height: 1.05;
        font-weight: 850;
        letter-spacing: -0.02em;
      }
      .manual-subtitle {
        margin: 10px 0 0;
        color: #6b7280;
        font-size: 16px;
        line-height: 1.5;
      }
      .toolbar {
        display: grid;
        gap: 20px;
        margin-bottom: 28px;
      }
      .search {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 10px;
        align-items: stretch;
      }
      .search-field {
        position: relative;
        min-width: 0;
      }
      .search-icon {
        position: absolute;
        top: 50%;
        left: 16px;
        width: 18px;
        height: 18px;
        transform: translateY(-50%);
        color: #9ca3af;
        pointer-events: none;
      }
      .search input {
        width: 100%;
        min-height: 52px;
        border: 1px solid #e5e7eb;
        border-radius: 14px;
        padding: 0 16px 0 46px;
        color: #111827;
        background: #fff;
        font: inherit;
        font-size: 15px;
        box-shadow: 0 1px 2px rgba(17, 24, 39, 0.04);
        outline: none;
        transition: border-color 0.15s ease, box-shadow 0.15s ease;
      }
      .search input:focus {
        border-color: #111827;
        box-shadow: 0 0 0 3px rgba(17, 24, 39, 0.08);
      }
      .search input:disabled,
      .search input[readonly] {
        color: #6b7280;
        background: #f3f4f6;
        cursor: not-allowed;
      }
      .search-submit {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        min-width: 112px;
        min-height: 52px;
        border: 0;
        border-radius: 14px;
        padding: 0 20px;
        color: #fff;
        background: #111827;
        font: inherit;
        font-size: 15px;
        font-weight: 750;
        cursor: pointer;
        transition: background 0.15s ease, opacity 0.15s ease;
      }
      .search-submit:hover {
        background: #000;
      }
      .search-submit:disabled {
        opacity: 0.72;
        cursor: wait;
      }
      .search-submit-spinner {
        display: none;
        width: 16px;
        height: 16px;
        border: 2px solid rgba(255, 255, 255, 0.35);
        border-top-color: #fff;
        border-radius: 50%;
        animation: pgy-spin 0.7s linear infinite;
      }
      body.is-loading .search-submit-spinner {
        display: inline-block;
      }
      body.is-loading .search-submit-label {
        display: none;
      }
      .manual-content {
        position: relative;
        min-height: 0;
      }
      .content-loading {
        position: absolute;
        inset: 0;
        z-index: 20;
        display: none;
        border-radius: 16px;
        background: rgba(247, 248, 250, 0.78);
        backdrop-filter: blur(2px);
      }
      body.is-loading .content-loading {
        display: block;
      }
      .content-loading-card {
        position: sticky;
        top: 24vh;
        display: grid;
        gap: 12px;
        justify-items: center;
        width: fit-content;
        min-width: 160px;
        margin: 48px auto 0;
        padding: 22px 28px;
        border: 1px solid #e5e7eb;
        border-radius: 16px;
        background: #fff;
        box-shadow: 0 12px 32px rgba(17, 24, 39, 0.08);
        color: #374151;
        font-size: 14px;
        font-weight: 650;
      }
      .content-loading-spinner {
        width: 28px;
        height: 28px;
        border: 3px solid #e5e7eb;
        border-top-color: #111827;
        border-radius: 50%;
        animation: pgy-spin 0.7s linear infinite;
      }
      @keyframes pgy-spin {
        to { transform: rotate(360deg); }
      }
      .categories-wrap {
        display: grid;
        gap: 8px;
      }
      .categories {
        display: flex;
        flex-wrap: nowrap;
        gap: 8px;
        overflow-x: auto;
        padding-bottom: 2px;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
      }
      .categories::-webkit-scrollbar { display: none; }
      .categories-hints {
        display: none;
      }
      .category {
        display: inline-flex;
        align-items: center;
        flex: 0 0 auto;
        min-height: 40px;
        border: 1px solid #e5e7eb;
        border-radius: 999px;
        padding: 0 16px;
        color: #374151;
        background: #fff;
        font-size: 14px;
        font-weight: 700;
        text-decoration: none;
        cursor: pointer;
        transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
      }
      .category.is-active {
        border-color: #111827;
        color: #fff;
        background: #111827;
      }
      .manual-list {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 18px;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .manual-item {
        display: flex;
        flex-direction: column;
        min-height: 100%;
        border: 1px solid #e8eaee;
        border-radius: 16px;
        background: #fff;
        box-shadow: 0 1px 2px rgba(17, 24, 39, 0.03);
        transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
      }
      .manual-item:hover {
        border-color: #d1d5db;
        box-shadow: 0 8px 24px rgba(17, 24, 39, 0.06);
        transform: translateY(-1px);
      }
      .manual-item[hidden] {
        display: none;
      }
      .manual-card {
        display: flex;
        flex-direction: column;
        flex: 1 1 auto;
        min-height: 100%;
        padding: 24px 20px 18px;
        color: inherit;
        text-decoration: none;
      }
      .manual-icon-wrap {
        position: relative;
        display: grid;
        height: 88px;
        margin-bottom: 16px;
      }
      .manual-icon {
        width: 64px;
        height: 80px;
        display: block;
        background: ${pdfIcon ? `url("${escapeCssUrl(pdfIcon)}") center / contain no-repeat` : "none"};
      }
      .manual-icon-fallback {
        position: absolute;
        inset: 0;
        display: ${pdfIcon ? "none" : "grid"};
        place-items: center;
        margin: auto;
        width: 64px;
        height: 80px;
        border: 2px solid #ef4444;
        border-radius: 6px;
        color: #111827;
        font-size: 14px;
        font-weight: 800;
        background: #fff;
      }
      .manual-main {
        flex: 1 1 auto;
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
        margin-top: 8px;
        color: #6b7280;
        font-size: 13px;
        line-height: 1.45;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .manual-view {
        display: inline-flex;
        align-items: center;
        align-self: flex-start;
        gap: 4px;
        margin-top: 20px;
        color: #111827;
        font-size: 14px;
        font-weight: 750;
        line-height: 1.2;
      }
      .manual-view-arrow {
        transition: transform 0.15s ease;
      }
      .manual-item:hover .manual-view-arrow {
        transform: translateX(2px);
      }
      .manual-chevron {
        display: none;
      }
      mark {
        border-radius: 4px;
        padding: 0 2px;
        color: inherit;
        background: #fff2a8;
      }
      .empty {
        border: 1px solid #e5e7eb;
        border-radius: 16px;
        padding: 28px;
        color: #6b7280;
        background: #fff;
        text-align: center;
      }
      body.is-embedded {
        background: transparent;
      }
      body.is-embedded .manual-page {
        padding-top: 28px;
        padding-bottom: 16px;
      }
      @media (max-width: 960px) {
        .manual-list {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
      @media (max-width: 680px) {
        .manual-page {
          padding: 28px 16px 40px;
        }
        .manual-subtitle {
          font-size: 14px;
        }
        .search {
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 8px;
        }
        .search input {
          min-height: 44px;
          border-radius: 12px;
          font-size: 14px;
        }
        .search-submit {
          width: auto;
          min-width: 72px;
          min-height: 44px;
          padding: 0 14px;
          border-radius: 12px;
          font-size: 13px;
        }
        .search-submit-spinner {
          width: 14px;
          height: 14px;
        }
        .categories-hints {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 18px;
          color: #111827;
          pointer-events: none;
          user-select: none;
        }
        .categories-hint {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 22px;
          height: 22px;
          border-radius: 999px;
          background: #eef0f3;
          font-size: 16px;
          line-height: 1;
          opacity: 0.22;
          transition: opacity 0.2s ease;
        }
        .categories-hint.is-active {
          opacity: 0.9;
        }
        .manual-list {
          grid-template-columns: 1fr;
          gap: 12px;
        }
        .manual-item {
          border-radius: 14px;
        }
        .manual-item:hover {
          transform: none;
          box-shadow: 0 1px 2px rgba(17, 24, 39, 0.03);
        }
        .manual-card {
          display: grid;
          grid-template-columns: 56px minmax(0, 1fr) auto;
          gap: 12px 14px;
          align-items: center;
          padding: 16px;
        }
        .manual-icon-wrap {
          height: auto;
          margin: 0;
        }
        .manual-icon,
        .manual-icon-fallback {
          width: 48px;
          height: 60px;
        }
        .manual-icon-fallback {
          font-size: 11px;
        }
        .manual-main {
          text-align: left;
          min-width: 0;
        }
        .manual-name {
          font-size: 16px;
        }
        .manual-sku {
          margin-top: 4px;
          font-size: 12px;
        }
        .manual-view {
          display: none;
        }
        .manual-chevron {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 20px;
          color: #9ca3af;
          font-size: 22px;
          line-height: 1;
        }
      }
    </style>
  </head>
  <body class="${embedded ? "is-embedded" : ""}">
    <main class="manual-page">
      <header class="manual-header">
        <h1 class="manual-title">User Manuals</h1>
        <p class="manual-subtitle">Find the manual for your PGYTECH product.</p>
      </header>
      <div class="toolbar">
        <form class="search" method="get" action="${escapeHtml(path)}" data-manual-search>
          <div class="search-field">
            <svg class="search-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"></circle>
              <path d="M20 20l-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
            </svg>
            <input type="search" name="q" value="${escapeHtml(query)}" placeholder="Search by product name, model or SKU" aria-label="Search manuals" enterkeyhint="search">
          </div>
          <button class="search-submit" type="submit">
            <span class="search-submit-spinner" aria-hidden="true"></span>
            <span class="search-submit-label">Search</span>
          </button>
          <input type="hidden" name="embedded" value="${embedded ? "1" : "0"}">
          ${
            pdfIcon && /^https?:\/\//i.test(pdfIcon)
              ? `<input type="hidden" name="pdfIcon" value="${escapeHtml(pdfIcon)}">`
              : ""
          }
        </form>
        <div class="categories-wrap" data-categories-wrap>
          <nav class="categories" aria-label="Manual categories" data-categories>
            ${renderCategoryButton("All", "")}
            ${MANUAL_PRODUCT_SERIES
              .map((item) => renderCategoryButton(item, categoryKey(item)))
              .join("")}
          </nav>
          <div class="categories-hints" aria-hidden="true">
            <span class="categories-hint categories-hint--left" data-cat-hint-left>‹</span>
            <span class="categories-hint categories-hint--right" data-cat-hint-right>›</span>
          </div>
        </div>
      </div>
      ${
        manuals.length
          ? `<div class="manual-content" data-manual-content>
          <ul class="manual-list">${manuals
            .map((manual) => renderManualItem(manual, normalizedQuery))
            .join("")}</ul>
          <div class="empty" data-filter-empty hidden>No manuals found in this category.</div>
          <div class="content-loading" data-content-loading aria-live="polite" aria-busy="false" hidden>
            <div class="content-loading-card">
              <div class="content-loading-spinner" aria-hidden="true"></div>
              <span>Searching...</span>
            </div>
          </div>
        </div>`
          : `<div class="manual-content" data-manual-content>
          <div class="empty">No manuals found.</div>
          <div class="content-loading" data-content-loading aria-live="polite" aria-busy="false" hidden>
            <div class="content-loading-card">
              <div class="content-loading-spinner" aria-hidden="true"></div>
              <span>Searching...</span>
            </div>
          </div>
        </div>`
      }
    </main>
    <script>
      (function () {
        var form = document.querySelector("[data-manual-search]");
        var page = document.querySelector(".manual-page");
        var loading = document.querySelector("[data-content-loading]");
        var searchInput = form ? form.querySelector('input[name="q"]') : null;
        var submitButton = form ? form.querySelector(".search-submit") : null;
        var heightTimer = null;
        var lastReportedHeight = 0;

        function measureHeight() {
          if (!page) {
            return Math.max(
              document.documentElement ? document.documentElement.scrollHeight : 0,
              document.body ? document.body.scrollHeight : 0,
            );
          }
          var styles = window.getComputedStyle(document.body);
          var marginBottom = parseFloat(styles.marginBottom) || 0;
          return Math.ceil(page.offsetTop + page.offsetHeight + marginBottom);
        }

        function reportHeight(force) {
          var height = measureHeight();
          if (height <= 0) return;
          if (!force && Math.abs(height - lastReportedHeight) < 2) return;
          lastReportedHeight = height;
          if (window.parent && window.parent !== window) {
            window.parent.postMessage(
              { source: "pgy-user-manuals", type: "resize", height: height },
              "*",
            );
          }
        }

        function scheduleReportHeight() {
          window.clearTimeout(heightTimer);
          heightTimer = window.setTimeout(function () {
            reportHeight(false);
          }, 80);
        }

        function syncReportHeight() {
          window.clearTimeout(heightTimer);
          reportHeight(true);
          window.requestAnimationFrame(function () {
            reportHeight(true);
          });
        }

        function setLoading(isLoading) {
          document.body.classList.toggle("is-loading", isLoading);
          if (loading) {
            loading.hidden = !isLoading;
            loading.setAttribute("aria-busy", isLoading ? "true" : "false");
          }
          if (searchInput) {
            searchInput.readOnly = isLoading;
            if (isLoading) searchInput.blur();
          }
          if (submitButton) submitButton.disabled = isLoading;
          scheduleReportHeight();
        }

        if (form) {
          form.addEventListener("submit", function () {
            setLoading(true);
          });
        }

        var categories = document.querySelector("[data-categories]");
        var hintLeft = document.querySelector("[data-cat-hint-left]");
        var hintRight = document.querySelector("[data-cat-hint-right]");

        function updateCategoryHints() {
          if (!categories || !hintLeft || !hintRight) return;
          var maxScroll = categories.scrollWidth - categories.clientWidth;
          var canScroll = maxScroll > 4;
          var atStart = categories.scrollLeft <= 2;
          var atEnd = categories.scrollLeft >= maxScroll - 2;
          hintLeft.classList.toggle("is-active", canScroll && !atStart);
          hintRight.classList.toggle("is-active", canScroll && !atEnd);
        }

        if (categories) {
          categories.addEventListener("scroll", updateCategoryHints, { passive: true });
          window.addEventListener("resize", function () {
            updateCategoryHints();
            scheduleReportHeight();
          });
          if (typeof ResizeObserver !== "undefined") {
            new ResizeObserver(updateCategoryHints).observe(categories);
          }
          updateCategoryHints();
        }

        if (page && typeof ResizeObserver !== "undefined") {
          new ResizeObserver(scheduleReportHeight).observe(page);
        }

        reportHeight(true);
        window.setTimeout(function () {
          reportHeight(true);
        }, 100);
        window.setTimeout(function () {
          reportHeight(true);
        }, 300);

        var buttons = Array.prototype.slice.call(document.querySelectorAll("[data-category-button]"));
        var items = Array.prototype.slice.call(document.querySelectorAll("[data-manual-category]"));
        var empty = document.querySelector("[data-filter-empty]");
        if (!buttons.length) return;

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
            syncReportHeight();
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
  const titleText = manual.title || manual.fileName || "User Manual";
  const titleHtml = highlightText(titleText, query);
  const skuHtml = `Model: ${highlightText(orderSkuList(manual.sku, query), query)}`;
  const fileUrl = escapeHtml(manual.fileUrl);

  return `<li class="manual-item" data-manual-category="${escapeHtml(categoryKey(manual.productSeries))}">
    <a class="manual-card" href="${fileUrl}" target="_blank" rel="noopener" aria-label="View manual: ${escapeHtml(titleText)}">
      <div class="manual-icon-wrap">
        <span class="manual-icon" role="img" aria-label="PDF"></span>
        <span class="manual-icon-fallback" aria-hidden="true">PDF</span>
      </div>
      <div class="manual-main">
        <span class="manual-name">${titleHtml}</span>
        <span class="manual-sku">${skuHtml}</span>
      </div>
      <span class="manual-view">View Manual <span class="manual-view-arrow" aria-hidden="true">→</span></span>
      <span class="manual-chevron" aria-hidden="true">›</span>
    </a>
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

function escapeCssUrl(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[\n\r\f]/g, "");
}
