import {
  drawMysteryBoxPrize,
  getMysteryBoxPageData,
  MYSTERY_BOX_PROXY_PATH,
} from "../lib/mystery-box.server";

export const loader = async ({ request }) => {
  let data;
  try {
    data = await getMysteryBoxPageData(request);
  } catch (error) {
    console.error("[mystery-box-page]", error);
    return new Response(renderPageError(error), {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  if (!data.ok) {
    return new Response(renderPageError(data.message), {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  const url = new URL(request.url);
  if (url.searchParams.get("status") === "1") {
    return Response.json(getMysteryBoxStatus(data));
  }

  return new Response(renderPage(data), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
};

export const action = async ({ request }) => {
  let result;
  try {
    result = await drawMysteryBoxPrize(request);
  } catch (error) {
    console.error("[mystery-box-draw]", error);
    result = {
      ok: false,
      message: error?.message || "Draw failed. Please try again.",
    };
  }
  return Response.json(result, {
    status: 200,
  });
};

function renderPageError(error) {
  const message =
    typeof error === "string"
      ? error
      : error?.message || "Something went wrong.";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>PGY Lucky Box</title>
    <style>
      body {
        margin: 0;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f5f6f8;
        color: #111827;
      }
      .error {
        width: min(100%, 720px);
        margin: 40px auto;
        padding: 24px;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        background: #fff;
      }
      h1 { margin: 0 0 10px; }
      p { color: #4b5563; line-height: 1.55; }
      code {
        display: block;
        margin-top: 14px;
        white-space: pre-wrap;
        color: #be123c;
      }
    </style>
  </head>
  <body>
    <main class="error">
      <h1>Lucky box is temporarily unavailable</h1>
      <p>Please refresh this page in a moment.</p>
      <code>${escapeHtml(message)}</code>
    </main>
  </body>
</html>`;
}

function renderPage(data) {
  const loginRequired = data.status === "login_required";
  const notConfigured = data.status === "not_configured";
  const hasAvailableDraw = Number(data.availableDrawCount || 0) > 0;
  const canOpen = (data.status === "ready" && hasAvailableDraw) || loginRequired;
  const loginUrl = `/customer_authentication/login?return_to=${encodeURIComponent(
    MYSTERY_BOX_PROXY_PATH,
  )}`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>PGY Lucky Box</title>
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f5f6f8;
        color: #111827;
      }
      .page {
        width: min(100%, 920px);
        margin: 0 auto;
        padding: 28px 16px 34px;
      }
      .panel {
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        background: #fff;
        padding: 20px;
      }
      .panel + .panel {
        margin-top: 16px;
      }
      .info {
        position: relative;
        text-align: center;
        box-shadow: 0 16px 40px rgba(17, 24, 39, 0.07);
      }
      .eyebrow {
        margin: 0 0 8px;
        color: #be123c;
        font-size: 13px;
        font-weight: 850;
        text-transform: uppercase;
      }
      h1, h2, p {
        margin-top: 0;
      }
      h1 {
        margin-bottom: 10px;
        font-size: clamp(25px, 3vw, 35px);
        line-height: 1.05;
      }
      h2 {
        margin-bottom: 14px;
        font-size: 18px;
      }
      .info-actions {
        display: flex;
        align-items: center;
        justify-content: center;
        flex-wrap: wrap;
        gap: 10px;
      }
      .stats-line {
        margin: 18px 0 0;
        color: #374151;
        font-size: 15px;
        line-height: 1.45;
      }
      .stats-line strong {
        color: #111827;
      }
      .stats-divider {
        color: #9ca3af;
        padding: 0 8px;
      }
      .info-links {
        position: absolute;
        top: 18px;
        right: 18px;
        display: flex;
        align-items: center;
        gap: 14px;
      }
      .icon-button {
        border: 0;
        background: transparent;
        color: #6b7280;
        padding: 0;
        font-size: 13px;
        font-weight: 750;
        line-height: 1.4;
        text-decoration: underline;
        text-underline-offset: 3px;
        cursor: pointer;
      }
      .text-button {
        min-height: auto;
        border: 0;
        background: transparent;
        color: #6b7280;
        padding: 0;
        font-size: 13px;
        font-weight: 750;
        line-height: 1.4;
        text-decoration: underline;
        text-underline-offset: 3px;
        cursor: pointer;
      }
      .prize-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
      }
      .prize {
        position: relative;
        display: grid;
        grid-template-columns: 96px minmax(0, 1fr);
        min-height: 106px;
        border: 1px solid #edf0f3;
        border-radius: 8px;
        background: #fafafa;
        overflow: hidden;
      }
      .prize-image {
        aspect-ratio: auto;
        min-height: 106px;
        background: #fff;
        border-right: 1px solid #edf0f3;
      }
      .prize-image img {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: contain;
      }
      .placeholder {
        display: grid;
        place-items: center;
        width: 100%;
        height: 100%;
        color: #9ca3af;
        font-size: 12px;
        font-weight: 850;
      }
      .prize-body {
        display: grid;
        align-content: center;
        padding: 26px 10px 10px;
      }
      .prize-name {
        min-height: 0;
        margin: 0;
        font-size: 12px;
        font-weight: 800;
        line-height: 1.32;
      }
      .probability,
      .record-result {
        display: inline-flex;
        align-items: center;
        border-radius: 999px;
        padding: 4px 8px;
        font-size: 11px;
        font-weight: 850;
      }
      .probability {
        position: absolute;
        top: 8px;
        right: 8px;
        margin: 0;
        background: #111827;
        color: #fff;
      }
      .probability-muted,
      .record-result {
        background: #e5e7eb;
        color: #374151;
      }
      .record-result.is-win {
        background: #dcfce7;
        color: #047857;
      }
      .draw-stage {
        display: grid;
        justify-items: center;
        gap: 16px;
        text-align: center;
      }
      .flip-card {
        display: block;
        width: min(270px, 78vw);
        height: 340px;
        perspective: 1000px;
        border: 0;
        background: transparent;
        padding: 0;
      }
      .flip-inner {
        display: block;
        position: relative;
        width: 100%;
        height: 100%;
        transform-style: preserve-3d;
        transition: transform 0.72s cubic-bezier(0.2, 0.8, 0.2, 1);
      }
      .flip-card.is-open .flip-inner {
        transform: rotateY(180deg);
      }
      .flip-card.is-shuffling .flip-inner {
        animation: shuffle-card 0.55s ease-in-out infinite;
      }
      .face {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        border: 1px solid #d1d5db;
        border-radius: 8px;
        backface-visibility: hidden;
        padding: 20px;
        text-align: center;
      }
      .front {
        background: linear-gradient(145deg, #111827, #374151);
        color: #fff;
        box-shadow: 0 18px 44px rgba(17, 24, 39, 0.18);
      }
      .back {
        background: #fff;
        color: #111827;
        transform: rotateY(180deg);
      }
      .card-mark {
        display: block;
        font-size: 54px;
        font-weight: 950;
      }
      .card-copy {
        display: block;
        margin-top: 8px;
        font-size: 15px;
        font-weight: 800;
        line-height: 1.35;
      }
      .button {
        border: 0;
        border-radius: 8px;
        background: #111827;
        color: #fff;
        min-height: 52px;
        min-width: 210px;
        padding: 0 20px;
        font-size: 16px;
        font-weight: 850;
        cursor: pointer;
      }
      .button[disabled] {
        cursor: not-allowed;
        opacity: 0.48;
      }
      .result {
        min-height: 24px;
        margin: 0;
        color: #4b5563;
        font-weight: 800;
      }
      .result[data-tone="success"] { color: #047857; }
      .result[data-tone="neutral"] { color: #6b7280; }
      .result[data-tone="critical"] { color: #be123c; }
      .footer-actions {
        display: flex;
        justify-content: center;
        gap: 12px;
        margin-top: 18px;
      }
      .link-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 42px;
        border: 1px solid #d1d5db;
        border-radius: 8px;
        background: #fff;
        color: #111827;
        padding: 0 16px;
        font-size: 14px;
        font-weight: 800;
        text-decoration: none;
      }
      .modal {
        position: fixed;
        inset: 0;
        display: none;
        place-items: center;
        background: rgba(17, 24, 39, 0.38);
        padding: 16px;
        z-index: 10;
      }
      .modal.is-open {
        display: grid;
      }
      .modal-card {
        width: min(560px, calc(100vw - 32px));
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        padding: 0;
        background: #fff;
        box-shadow: 0 24px 80px rgba(17, 24, 39, 0.24);
      }
      .modal-head,
      .modal-body {
        padding: 18px;
      }
      .modal-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        border-bottom: 1px solid #e5e7eb;
      }
      .modal-head h2 {
        margin: 0;
      }
      .modal-close {
        width: 34px;
        height: 34px;
        border: 1px solid #d1d5db;
        border-radius: 999px;
        background: #fff;
        cursor: pointer;
      }
      .record-list {
        display: grid;
        gap: 10px;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .record {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 12px;
        align-items: center;
        border: 1px solid #edf0f3;
        border-radius: 8px;
        background: #fafafa;
        padding: 12px;
      }
      .record strong,
      .record span {
        display: block;
      }
      .record span,
      .empty {
        color: #6b7280;
        font-size: 13px;
      }
      .empty {
        margin: 0;
        line-height: 1.5;
      }
      @keyframes shuffle-card {
        0%, 100% { transform: translateY(0) rotateZ(0); }
        35% { transform: translateY(-4px) rotateZ(-2deg); }
        70% { transform: translateY(3px) rotateZ(2deg); }
      }
      @media (max-width: 760px) {
        .page {
          padding: 18px 12px 28px;
        }
        .panel {
          padding: 18px;
        }
        .info {
          display: flex;
          flex-direction: column;
        }
        .info-actions {
          width: min(100%, 280px);
          margin: 0 auto;
        }
        .stats-line {
          font-size: 12px;
        }
        .info-links {
          position: static;
          justify-content: center;
          flex-wrap: wrap;
          gap: 12px;
          margin-top: 18px;
          order: 10;
        }
        .text-button {
          white-space: nowrap;
        }
        .icon-button {
          min-height: auto;
        }
        .prize-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
        }
        .prize {
          grid-template-columns: 72px minmax(0, 1fr);
          min-height: 92px;
        }
        .prize-image {
          min-height: 92px;
          border-right: 1px solid #edf0f3;
          border-bottom: 0;
        }
        .prize-body {
          padding: 26px 8px 8px;
        }
        .prize-name {
          min-height: 0;
          font-size: 10px;
        }
        .flip-card {
          width: min(230px, 68vw);
          height: min(300px, 58vh);
        }
        .footer-actions { flex-direction: column; }
        .link-button { width: 100%; }
      }
      @media (max-width: 380px) {
        h1 {
          font-size: 25px;
        }
        .subtitle {
          font-size: 15px;
        }
        .prize {
          grid-template-columns: 64px minmax(0, 1fr);
          min-height: 86px;
        }
        .prize-image {
          min-height: 86px;
        }
        .probability {
          top: 6px;
          right: 6px;
          padding: 3px 7px;
          font-size: 10px;
        }
        .flip-card {
          width: min(210px, 66vw);
          height: 270px;
        }
      }
    </style>
  </head>
  <body>
    <main class="page">
      ${renderInfoTemplate(data)}
      ${renderPrizeTemplate(data.currentRules)}
      ${renderDrawTemplate({ loginRequired, notConfigured, hasAvailableDraw, canOpen, loginUrl, data })}

      <div class="footer-actions">
        <a class="link-button" href="/">Back to home</a>
        <a class="link-button" href="/account">Back to account</a>
      </div>
    </main>

    ${renderRecordDialog(data.existingDraws)}
    ${renderRulesDialog(data)}

    <script>
      (function () {
        var button = document.querySelector("[data-draw-button]");
        var result = document.querySelector("[data-result]");
        var card = document.querySelector("[data-draw-card]");
        var remainingCount = document.querySelector("[data-remaining-count]");
        var recordList = document.querySelector("[data-record-list]");
        var recordEmpty = document.querySelector("[data-record-empty]");
        var modal = document.querySelector("[data-record-modal]");
        var openModal = document.querySelector("[data-open-records]");
        var closeModal = document.querySelector("[data-close-records]");
        var rulesModal = document.querySelector("[data-rules-modal]");
        var openRules = document.querySelector("[data-open-rules]");
        var closeRules = document.querySelector("[data-close-rules]");

        if (openModal && modal) {
          openModal.addEventListener("click", function () {
            modal.classList.add("is-open");
            modal.setAttribute("aria-hidden", "false");
          });
        }
        if (closeModal && modal) {
          closeModal.addEventListener("click", function () {
            closeRecordsModal();
          });
          modal.addEventListener("click", function (event) {
            if (event.target === modal) closeRecordsModal();
          });
        }
        if (openRules && rulesModal) {
          openRules.addEventListener("click", function () {
            rulesModal.classList.add("is-open");
            rulesModal.setAttribute("aria-hidden", "false");
          });
        }
        if (closeRules && rulesModal) {
          closeRules.addEventListener("click", function () {
            closeRulesModal();
          });
          rulesModal.addEventListener("click", function (event) {
            if (event.target === rulesModal) closeRulesModal();
          });
        }
        function closeRecordsModal() {
          modal.classList.remove("is-open");
          modal.setAttribute("aria-hidden", "true");
        }
        function closeRulesModal() {
          rulesModal.classList.remove("is-open");
          rulesModal.setAttribute("aria-hidden", "true");
        }

        if (!button || !result || !card || button.disabled) return;
        button.addEventListener("click", async function () {
          if (button.dataset.loginUrl) {
            window.location.href = button.dataset.loginUrl;
            return;
          }

          card.classList.remove("is-open");
          card.classList.add("is-shuffling");
          button.disabled = true;
          button.textContent = "Opening...";
          result.dataset.tone = "neutral";
          result.textContent = "Drawing your reward...";

          try {
            var response = await fetch("${MYSTERY_BOX_PROXY_PATH}" + window.location.search, {
              method: "POST",
              headers: { "accept": "application/json" }
            });
            var json = await response.json();
            if (!json.ok) throw new Error(json.message || "Draw failed");

            var draw = json.draw;
            var title = card.querySelector("[data-card-title]");
            var copy = card.querySelector("[data-card-copy]");
            card.classList.remove("is-shuffling");
            card.classList.add("is-open");

            if (title) title.textContent = draw.prizeType === "prize" ? "WIN" : "PGY";
            if (copy) {
              copy.textContent = draw.prizeType === "prize"
                ? (draw.prizeTitle || "Prize unlocked")
                : "No prize this time";
            }

            result.dataset.tone = draw.prizeType === "prize" ? "success" : "neutral";
            result.textContent = draw.prizeType === "prize"
              ? "Congratulations! You won " + (draw.prizeTitle || draw.prizeSku)
              : "Thanks for joining. No prize this time.";

            appendDrawRecord(draw);
            if (remainingCount && json.remainingDrawCount != null) {
              remainingCount.textContent = String(json.remainingDrawCount);
            }
            if (json.remainingDrawCount > 0) {
              button.disabled = false;
              button.textContent = "Open next reward";
            } else {
              button.textContent = json.alreadyDrawn ? "Already opened" : "Opened";
            }
          } catch (error) {
            card.classList.remove("is-shuffling");
            result.dataset.tone = "critical";
            result.textContent = error.message || "Something went wrong.";
            button.disabled = false;
            button.textContent = "Try again";
          }
        });

        function appendDrawRecord(draw) {
          if (!recordList) return;
          if (recordEmpty) recordEmpty.remove();
          var item = document.createElement("li");
          item.className = "record";
          var resultLabel = draw.prizeType === "prize"
            ? (draw.prizeTitle || draw.prizeSku || "Prize")
            : "No prize";
          item.innerHTML =
            '<div><strong>' + escapeText(draw.orderName || "Order") + '</strong>' +
            '<span>' + escapeText(new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })) + '</span></div>' +
            '<div class="record-result ' + (draw.prizeType === "prize" ? "is-win" : "") + '">' + escapeText(resultLabel) + '</div>';
          recordList.prepend(item);
        }

        function escapeText(value) {
          return String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
        }
      })();
    </script>
  </body>
</html>`;
}

function renderInfoTemplate(data) {
  return `<section class="panel info">
    <div class="info-links">
      <button class="text-button" type="button" data-open-records>Lucky draw records</button>
      <button class="icon-button" type="button" data-open-rules>Game rules</button>
    </div>
    <h1>PGY Lucky Box</h1>
    <div class="info-actions">
      <p class="stats-line">
        <span>Draw chances: <strong data-remaining-count>${escapeHtml(data.availableDrawCount || 0)}</strong></span>
        <span class="stats-divider">|</span>
        <span>Qualified orders: <strong>${escapeHtml(data.totalEligibleCount || 0)}</strong></span>
      </p>
    </div>
  </section>`;
}

function renderPrizeTemplate(rules) {
  return `<section class="panel">
    <h2>Prizes</h2>
    <div class="prize-grid">${renderPrizeCards(rules)}</div>
  </section>`;
}

function renderDrawTemplate({ loginRequired, notConfigured, hasAvailableDraw, canOpen, loginUrl, data }) {
  return `<section class="panel">
    <h2>Draw</h2>
    <div class="draw-stage">
      <button class="flip-card" type="button" data-draw-card tabindex="-1" aria-label="Lucky box reward card">
        <span class="flip-inner">
          <span class="face front">
            <span>
              <span class="card-mark">?</span>
              <span class="card-copy">Lucky Box</span>
            </span>
          </span>
          <span class="face back">
            <span>
              <span class="card-mark" data-card-title>PGY</span>
              <span class="card-copy" data-card-copy>Reward result</span>
            </span>
          </span>
        </span>
      </button>
      <p class="result" data-result>${escapeHtml(
        data.eligibleOrder
          ? `Next reward uses order ${data.eligibleOrder.name}.`
          : "Your reward status will appear here.",
      )}</p>
      <button class="button" data-draw-button ${
        loginRequired ? `data-login-url="${escapeHtml(loginUrl)}"` : ""
      } ${canOpen ? "" : "disabled"}>${escapeHtml(
        getButtonLabel({ loginRequired, notConfigured, hasAvailableDraw }),
      )}</button>
    </div>
  </section>`;
}

function renderPrizeCards(rules) {
  const normalized = rules || { prizes: [], noPrizeProbability: 0 };
  const cards = (normalized.prizes || []).map((prize) => {
    const name = prize.title || "Configured prize";
    return `<article class="prize">
      <div class="prize-image">${renderPrizeImage(prize, name)}</div>
      <div class="prize-body">
        <p class="prize-name">${escapeHtml(name)}</p>
        <span class="probability">${escapeHtml(formatProbability(prize.probability))}</span>
      </div>
    </article>`;
  });

  cards.push(`<article class="prize">
    <div class="prize-image"><div class="placeholder">THANKS</div></div>
    <div class="prize-body">
      <p class="prize-name">No prize</p>
      <span class="probability probability-muted">${escapeHtml(formatProbability(normalized.noPrizeProbability))}</span>
    </div>
  </article>`);

  return cards.join("");
}

function renderPrizeImage(prize, name) {
  if (!prize.imageUrl) return `<div class="placeholder">IMAGE</div>`;
  return `<img src="${escapeHtml(prize.imageUrl)}" alt="${escapeHtml(
    prize.imageAlt || name,
  )}" loading="lazy">`;
}

function renderRecordDialog(draws = []) {
  return `<div class="modal" data-record-modal aria-hidden="true">
    <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="lucky-record-title">
      <div class="modal-head">
        <h2 id="lucky-record-title">Lucky draw records</h2>
        <button class="modal-close" type="button" data-close-records aria-label="Close">x</button>
      </div>
      <div class="modal-body">${renderDrawRecords(draws)}</div>
    </div>
  </div>`;
}

function renderRulesDialog(data) {
  return `<div class="modal" data-rules-modal aria-hidden="true">
    <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="lucky-rules-title">
      <div class="modal-head">
        <h2 id="lucky-rules-title">Game rules</h2>
        <button class="modal-close" type="button" data-close-rules aria-label="Close">x</button>
      </div>
      <div class="modal-body">
        <ul class="record-list">
          ${getRulesList(data)
            .map((rule) => `<li class="record"><span>${escapeHtml(rule)}</span></li>`)
            .join("")}
        </ul>
      </div>
    </div>
  </div>`;
}

function renderDrawRecords(draws = []) {
  if (!draws.length) {
    return `<p class="empty" data-record-empty>No lucky box records yet.</p><ul class="record-list" data-record-list></ul>`;
  }

  return `<ul class="record-list" data-record-list>${draws
    .map((draw) => {
      const label =
        draw.prizeType === "prize"
          ? draw.prizeTitle || draw.prizeSku || "Prize"
          : "No prize";
      return `<li class="record">
        <div>
          <strong>${escapeHtml(draw.orderName || "Order")}</strong>
          <span>${escapeHtml(formatDate(draw.createdAt))}</span>
        </div>
        <div class="record-result ${draw.prizeType === "prize" ? "is-win" : ""}">${escapeHtml(label)}</div>
      </li>`;
    })
    .join("")}</ul>`;
}

function getRulesList(data) {
  const startDate = data.startDate || "the campaign start date";
  const amount =
    data.minOrderAmount == null
      ? "the configured amount"
      : formatAmount(data.minOrderAmount);
  return [
    `Paid orders from ${startDate} and over ${amount} qualify.`,
    "Each qualified order gives one draw chance.",
    "Each chance opens one reward card.",
    `The result follows the ${data.region === "US" ? "US" : "Global"} prize probabilities.`,
    "Opened orders cannot be used again.",
  ];
}

function getInitialMessage(data) {
  if (data.status === "not_configured") return "The lucky box is not available yet.";
  if (data.status === "login_required") return "Please log in to check your recent paid orders.";
  if (Number(data.availableDrawCount || 0) > 0) {
    return `You have ${data.availableDrawCount} reward draw opportunity${data.availableDrawCount === 1 ? "" : "ies"}.`;
  }
  if (Number(data.totalEligibleCount || 0) > 0) {
    return "All eligible orders have already opened a lucky box.";
  }
  return `Paid orders from ${data.startDate} that meet the configured amount can open one lucky box.`;
}

function getButtonLabel({ loginRequired, notConfigured, hasAvailableDraw }) {
  if (notConfigured) return "Not available";
  if (loginRequired) return "Log in";
  if (!hasAvailableDraw) return "No eligible draw";
  return "Open reward";
}

function getMysteryBoxStatus(data) {
  const hasEligibleOrder = Number(data.totalEligibleCount || 0) > 0;
  const availableDrawCount = Number(data.availableDrawCount || 0);
  return {
    ok: true,
    status: data.status,
    hasEligibleOrder,
    alreadyDrawn: hasEligibleOrder && availableDrawCount === 0,
    canDraw: data.status === "ready" && availableDrawCount > 0,
    loginRequired: data.status === "login_required",
    message: getInitialMessage(data),
    orderName: data.eligibleOrder?.name || null,
    totalEligibleCount: Number(data.totalEligibleCount || 0),
    availableDrawCount,
    usedDrawCount: Number(data.usedDrawCount || 0),
  };
}

function formatAmount(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return Number.isInteger(number) ? String(number) : number.toFixed(2);
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatProbability(value) {
  const number = Number(value || 0);
  return `${Number.isInteger(number) ? number : number.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}%`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
