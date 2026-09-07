(function () {
  var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn);
    } else {
      fn();
    }
  }

  function showMessage(el, text, isError) {
    if (!el) return;
    el.textContent = text || "";
    el.hidden = !text;
    el.classList.toggle("pgy-coupon-lottery__message--error", Boolean(isError));
    el.classList.toggle(
      "pgy-coupon-lottery__message--success",
      !isError && Boolean(text),
    );
  }

  async function readJson(response) {
    var contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) return null;
    try {
      return await response.json();
    } catch (error) {
      return null;
    }
  }

  function formatMoney(amount) {
    var value = Number(amount) || 0;
    if (Number.isInteger(value)) return "$" + value;
    return "$" + value.toFixed(2);
  }

  function withQuery(url, params) {
    var next = new URL(url, window.location.origin);
    Object.keys(params || {}).forEach(function (key) {
      if (params[key] != null && params[key] !== "") {
        next.searchParams.set(key, params[key]);
      }
    });
    return next.pathname + next.search;
  }

  ready(function () {
    document.querySelectorAll("[data-pgy-coupon-lottery]").forEach(initRoot);
  });

  function initRoot(root) {
    if (root.dataset.pgyClBound === "true") return;
    root.dataset.pgyClBound = "true";

    var proxyUrl = root.dataset.proxyUrl || "/apps/pgy-tech/coupon-lottery";
    var overlay = root.querySelector("[data-pgy-cl-overlay]");
    var prizesEl = root.querySelector("[data-pgy-cl-prizes]");
    var form = root.querySelector("[data-pgy-cl-form]");
    var emailInput = root.querySelector("[data-pgy-cl-email]");
    var agreeInput = root.querySelector("[data-pgy-cl-agree]");
    var messageEl = root.querySelector("[data-pgy-cl-message]");
    var submitBtn = root.querySelector("[data-pgy-cl-submit]");
    var copyMessageEl = root.querySelector("[data-pgy-cl-copy-message]");
    var strings = {
      invalid: root.dataset.msgInvalid || "Please enter a valid email address.",
      agree: root.dataset.msgAgree || "Please agree to receive offers.",
      error: root.dataset.msgError || "Something went wrong.",
      preview: root.dataset.msgPreview || "Please test on the live storefront.",
    };

    var state = {
      claim: null,
      alreadyClaimed: false,
    };

    var openButtons = root.querySelectorAll("[data-pgy-cl-open]");

    loadConfig();
    checkLoggedInClaim();

    openButtons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        openForm();
      });
    });

    root.querySelectorAll("[data-pgy-cl-close]").forEach(function (btn) {
      btn.addEventListener("click", closeOverlay);
    });

    if (overlay) {
      overlay.addEventListener("click", function (event) {
        if (event.target === overlay) closeOverlay();
      });
    }

    var copyBtn = root.querySelector("[data-pgy-cl-copy]");
    if (copyBtn) {
      copyBtn.addEventListener("click", function () {
        if (!state.claim || !state.claim.couponCode) return;
        copyText(state.claim.couponCode).then(function (ok) {
          showMessage(
            copyMessageEl,
            ok ? "Copied!" : "Copy failed. Please copy manually.",
            !ok,
          );
        });
      });
    }

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && overlay && !overlay.hidden) {
        closeOverlay();
      }
    });

    if (form) {
      form.addEventListener("submit", async function (event) {
        event.preventDefault();
        showMessage(messageEl, "", false);

        var email = String((emailInput && emailInput.value) || "").trim();
        if (!EMAIL_PATTERN.test(email)) {
          showMessage(messageEl, strings.invalid, true);
          return;
        }

        if (submitBtn) submitBtn.disabled = true;
        try {
          var response = await fetch(proxyUrl, {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            credentials: "same-origin",
            body: JSON.stringify({
              email: email,
              agreed: Boolean(agreeInput && agreeInput.checked),
            }),
          });
          var data = await readJson(response);
          if (response.status === 401) {
            showMessage(messageEl, strings.preview, true);
            return;
          }
          if (!response.ok || !data || !data.ok || !data.claim) {
            showMessage(
              messageEl,
              (data && data.error) || strings.error,
              true,
            );
            return;
          }
          showResult(data.claim, Boolean(data.alreadyClaimed));
          if (data.alreadyClaimed || data.claim) {
            state.claim = data.claim;
            state.alreadyClaimed = true;
            updateStageForClaimed();
          }
        } catch (error) {
          showMessage(messageEl, strings.preview, true);
        } finally {
          if (submitBtn) submitBtn.disabled = false;
        }
      });
    }

    async function loadConfig() {
      try {
        var configRes = await fetch(
          withQuery(proxyUrl, { action: "config" }),
          {
            method: "GET",
            headers: { Accept: "application/json" },
            credentials: "same-origin",
          },
        );
        var config = await readJson(configRes);
        if (config && config.ok && Array.isArray(config.prizes) && config.prizes.length) {
          renderPrizes(config.prizes);
        }
      } catch (error) {}
    }

    async function checkLoggedInClaim() {
      var knownEmail = getKnownEmail();
      if (!knownEmail) return;

      if (emailInput && !emailInput.value) {
        emailInput.value = knownEmail;
      }

      var existing = await fetchStatus(knownEmail);
      if (existing && existing.ok && existing.claimed && existing.claim) {
        state.claim = existing.claim;
        state.alreadyClaimed = true;
        updateStageForClaimed();
      }
    }

    function updateStageForClaimed() {
      openButtons.forEach(function (btn) {
        btn.textContent = "View My Coupon";
      });
    }

    async function openForm() {
      showMessage(messageEl, "", false);
      showMessage(copyMessageEl, "", false);
      if (!overlay) return;

      if (state.alreadyClaimed && state.claim) {
        showResult(state.claim, true);
        return;
      }

      overlay.hidden = false;
      document.documentElement.style.overflow = "hidden";

      var knownEmail = getKnownEmail();
      if (knownEmail) {
        if (emailInput) emailInput.value = knownEmail;
        var existing = await fetchStatus(knownEmail);
        if (existing && existing.claimed && existing.claim) {
          state.claim = existing.claim;
          state.alreadyClaimed = true;
          updateStageForClaimed();
          showResult(existing.claim, true);
          return;
        }
      }

      showStep("form");
      if (emailInput) {
        setTimeout(function () {
          emailInput.focus();
        }, 50);
      }
    }

    async function fetchStatus(email) {
      try {
        var response = await fetch(
          withQuery(proxyUrl, { action: "status", email: email }),
          {
            method: "GET",
            headers: { Accept: "application/json" },
            credentials: "same-origin",
          },
        );
        return await readJson(response);
      } catch (error) {
        return null;
      }
    }

    function getKnownEmail() {
      var fromCustomer = String(root.dataset.customerEmail || "").trim();
      if (EMAIL_PATTERN.test(fromCustomer)) return fromCustomer.toLowerCase();
      return "";
    }

    function renderPrizes(prizes) {
      if (!prizesEl) return;
      prizesEl.innerHTML = "";
      prizes.forEach(function (prize) {
        var card = document.createElement("div");
        card.className = "pgy-coupon-lottery__prize";
        card.innerHTML =
          '<div class="pgy-coupon-lottery__prize-amount">' +
          escapeHtml(prize.label || formatMoney(prize.discountAmount)) +
          "</div>" +
          '<div class="pgy-coupon-lottery__prize-label">COUPON</div>';
        prizesEl.appendChild(card);
      });
    }

    function escapeHtml(value) {
      return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    function showResult(claim, alreadyClaimed) {
      state.claim = claim;
      var titleEl = root.querySelector("[data-pgy-cl-result-title]");
      var subEl = root.querySelector("[data-pgy-cl-result-sub]");
      var amountEl = root.querySelector("[data-pgy-cl-result-amount]");
      var metaEl = root.querySelector("[data-pgy-cl-result-meta]");
      var codeEl = root.querySelector("[data-pgy-cl-result-code]");

      if (titleEl) {
        titleEl.textContent = alreadyClaimed
          ? "You already claimed a coupon"
          : "Your coupon is ready";
      }
      if (subEl) {
        subEl.textContent = alreadyClaimed
          ? "Each email can claim only once. Here is your existing code. Use it while logged in with this email."
          : "Use this code at checkout while logged in with the same email. Each email can claim only once.";
      }
      if (amountEl) {
        amountEl.textContent =
          claim.label || formatMoney(claim.discountAmount) + " OFF";
      }
      if (metaEl) {
        metaEl.textContent =
          "EXTRA " +
          formatMoney(claim.discountAmount) +
          " OFF on orders over " +
          formatMoney(claim.minSpend);
      }
      if (codeEl) codeEl.textContent = claim.couponCode;
      if (overlay) {
        overlay.hidden = false;
        document.documentElement.style.overflow = "hidden";
      }
      showStep("result");
    }

    function showStep(step) {
      root.querySelectorAll("[data-pgy-cl-step]").forEach(function (modal) {
        modal.hidden = modal.getAttribute("data-pgy-cl-step") !== step;
      });
    }

    function closeOverlay() {
      if (!overlay) return;
      overlay.hidden = true;
      document.documentElement.style.overflow = "";
      showStep("");
    }

    async function copyText(text) {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
          return true;
        }
      } catch (error) {}
      try {
        var area = document.createElement("textarea");
        area.value = text;
        area.setAttribute("readonly", "");
        area.style.position = "absolute";
        area.style.left = "-9999px";
        document.body.appendChild(area);
        area.select();
        var ok = document.execCommand("copy");
        document.body.removeChild(area);
        return ok;
      } catch (error) {
        return false;
      }
    }
  }
})();
