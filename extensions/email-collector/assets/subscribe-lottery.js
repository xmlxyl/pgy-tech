(function () {
  /** @param {string | null | undefined} value */
  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  /** @param {Response} response */
  async function readJsonResponse(response) {
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  /** @param {HTMLElement | null} el @param {string} message @param {boolean} isError */
  function showMessage(el, message, isError) {
    if (!el) return;
    if (!message) {
      el.hidden = true;
      el.textContent = "";
      el.classList.remove("pgy-lottery__message--success", "pgy-lottery__message--error");
      return;
    }
    el.hidden = false;
    el.textContent = message;
    el.classList.toggle("pgy-lottery__message--success", !isError);
    el.classList.toggle("pgy-lottery__message--error", isError);
  }

  /** @param {HTMLElement} root */
  function initLottery(root) {
    const proxyUrl = root.dataset.proxyUrl;
    const form = root.querySelector("[data-pgy-lottery-form]");
    const messageEl = root.querySelector("[data-pgy-lottery-message]");
    const prizeEls = /** @type {NodeListOf<HTMLElement>} */ (
      root.querySelectorAll("[data-pgy-lottery-prize]")
    );
    const submitBtn = form?.querySelector('button[type="submit"]');

    const strings = {
      success: root.dataset.msgSuccess || "Congratulations! Check your email for your coupon.",
      errorInvalid: root.dataset.msgErrorInvalid || "Please enter a valid email.",
      errorGeneric: root.dataset.msgErrorGeneric || "Something went wrong. Please try again.",
      errorPreview: root.dataset.msgErrorPreview || "Please test on your live storefront.",
      errorAlreadyPlayed: root.dataset.msgErrorAlready || "You have already entered.",
      spinning: root.dataset.msgSpinning || "Drawing your prize...",
    };

    /** @param {number} winnerSlot @param {() => void} onDone */
    function runSpinAnimation(winnerSlot, onDone) {
      const slots = Array.from(prizeEls).map((el) => Number(el.dataset.slot));
      if (slots.length === 0) {
        onDone();
        return;
      }

      let index = 0;
      let ticks = 0;
      const maxTicks = 24 + slots.indexOf(winnerSlot);
      const interval = window.setInterval(() => {
        prizeEls.forEach((el) => el.classList.remove("pgy-lottery__prize--active"));
        const current = prizeEls[index % prizeEls.length];
        current?.classList.add("pgy-lottery__prize--active");
        index += 1;
        ticks += 1;
        if (ticks >= maxTicks) {
          window.clearInterval(interval);
          prizeEls.forEach((el) => el.classList.remove("pgy-lottery__prize--active"));
          const winner = root.querySelector(`[data-pgy-lottery-prize][data-slot="${winnerSlot}"]`);
          winner?.classList.add("pgy-lottery__prize--winner");
          onDone();
        }
      }, 120);
    }

    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!proxyUrl || !form) return;

      const emailInput = /** @type {HTMLInputElement | null} */ (
        form.querySelector('input[name="email"]')
      );
      const email = emailInput?.value?.trim() ?? "";
      if (!email || !email.includes("@")) {
        showMessage(messageEl, strings.errorInvalid, true);
        return;
      }

      showMessage(messageEl, strings.spinning, false);
      if (submitBtn) submitBtn.disabled = true;
      prizeEls.forEach((el) => el.classList.remove("pgy-lottery__prize--winner"));

      try {
        const response = await fetch(proxyUrl, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          credentials: "same-origin",
          body: JSON.stringify({ email }),
        });
        const data = await readJsonResponse(response);

        if (response.ok && data?.ok && data.prize) {
          runSpinAnimation(Number(data.prize.slot), () => {
            const coupon = data.prize.couponCode ? ` Code: ${data.prize.couponCode}` : "";
            showMessage(
              messageEl,
              `${strings.success} ${data.prize.title}.${coupon}`,
              false,
            );
            if (emailInput) emailInput.value = "";
          });
        } else if (response.status === 409 && data?.prize) {
          showMessage(
            messageEl,
            `${strings.errorAlreadyPlayed} ${data.prize.title} (${data.prize.couponCode})`,
            true,
          );
        } else {
          const message = data?.error || strings.errorGeneric;
          if (response.status === 401) {
            showMessage(messageEl, strings.errorPreview, true);
          } else {
            showMessage(messageEl, message, true);
          }
        }
      } catch {
        showMessage(messageEl, strings.errorPreview, true);
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  document.querySelectorAll("[data-pgy-lottery]").forEach((root) => {
    initLottery(/** @type {HTMLElement} */ (root));
  });
})();
