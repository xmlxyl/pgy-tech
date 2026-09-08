(function () {
  /** @param {string | undefined | null} value */
  function normalizeMessage(value) {
    if (!value) return "";
    if (value.indexOf("&") === -1) return value;
    const textarea = document.createElement("textarea");
    textarea.innerHTML = value;
    return textarea.value;
  }

  function showMessage(el, text, isError) {
    if (!el) return;
    const normalized = normalizeMessage(text);
    el.textContent = normalized;
    el.hidden = !normalized;
    el.classList.toggle("pgy-email-signup__message--error", Boolean(isError));
    el.classList.toggle(
      "pgy-email-signup__message--success",
      !isError && Boolean(normalized),
    );
    el.classList.toggle("pgy-email-bar__message--error", Boolean(isError));
    el.classList.toggle(
      "pgy-email-bar__message--success",
      !isError && Boolean(normalized),
    );
    el.classList.toggle("pgy-email-popup__message--error", Boolean(isError));
    el.classList.toggle(
      "pgy-email-popup__message--success",
      !isError && Boolean(normalized),
    );
  }

  /** @param {HTMLElement | null} btn @param {boolean} loading */
  function setLoading(btn, loading) {
    if (!btn) return;
    btn.disabled = loading;
    btn.classList.toggle("is-loading", loading);
    btn.setAttribute("aria-busy", loading ? "true" : "false");
  }

  async function readJsonResponse(response) {
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return null;
    }
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  function bindEmailForms() {
    document.querySelectorAll("[data-pgy-email-form]").forEach((form) => {
      if (form.dataset.pgyEmailBound === "true") return;
      form.dataset.pgyEmailBound = "true";

      const proxyUrl = form.dataset.proxyUrl;
      const messageEl = form.querySelector("[data-pgy-email-message]");
      const submitBtn = form.querySelector("[type=submit]");
      const strings = {
        success: normalizeMessage(form.dataset.msgSuccess) || "Thanks!",
        already:
          normalizeMessage(form.dataset.msgAlready) || "Already subscribed.",
        errorInvalid:
          normalizeMessage(form.dataset.msgErrorInvalid) || "Invalid email.",
        errorGeneric:
          normalizeMessage(form.dataset.msgErrorGeneric) ||
          "Something went wrong.",
        errorPreview:
          normalizeMessage(form.dataset.msgErrorPreview) ||
          "请在店铺前台页面测试（打开在线商店），主题编辑器预览不支持提交。",
      };

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!proxyUrl) return;

        const emailInput = form.querySelector('input[name="email"]');
        const usernameInput = form.querySelector('input[name="username"]');
        const typeInput =
          form.querySelector('input[name="campaign_type"]') ||
          form.querySelector('input[name="type"]');
        const email = emailInput?.value?.trim() ?? "";
        const username = usernameInput?.value?.trim() ?? "";
        const type =
          typeInput?.value?.trim() ||
          form.dataset.campaignType?.trim() ||
          "";
        if (!email) {
          showMessage(messageEl, strings.errorInvalid, true);
          return;
        }

        showMessage(messageEl, "", false);
        setLoading(submitBtn, true);

        try {
          const params = new URLSearchParams({ email });
          if (username) params.set("username", username);
          if (type) {
            params.set("type", type);
            params.set("campaign_type", type);
          }
          const url = `${proxyUrl}${proxyUrl.includes("?") ? "&" : "?"}${params}`;

          const response = await fetch(url, {
            method: "GET",
            headers: { Accept: "application/json" },
            credentials: "same-origin",
          });
          const data = await readJsonResponse(response);

          if (response.ok && data?.ok) {
            if (data.alreadySubscribed) {
              showMessage(messageEl, strings.already, false);
            } else {
              showMessage(messageEl, strings.success, false);
              if (emailInput) emailInput.value = "";
            }
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
          setLoading(submitBtn, false);
        }
      });
    });
  }

  function bindEmailPopups() {
    document.querySelectorAll("[data-pgy-email-popup]").forEach((root) => {
      if (root.dataset.pgyPopupBound === "true") return;
      root.dataset.pgyPopupBound = "true";

      const openBtn = root.querySelector("[data-pgy-email-popup-open]");
      const overlay = root.querySelector("[data-pgy-email-popup-close]");
      const sheet = root.querySelector("[data-pgy-email-popup-sheet]");
      const emailInput = root.querySelector('input[name="email"]');

      if (!openBtn || !overlay || !sheet) return;

      const setOpen = (open) => {
        root.classList.toggle("is-open", open);
        openBtn.setAttribute("aria-expanded", open ? "true" : "false");
        overlay.hidden = !open;
        sheet.hidden = !open;
        document.body.classList.toggle("pgy-email-popup-lock", open);
        if (open) {
          window.setTimeout(() => emailInput?.focus(), 280);
        }
      };

      openBtn.addEventListener("click", () => setOpen(true));
      overlay.addEventListener("click", () => setOpen(false));

      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && root.classList.contains("is-open")) {
          setOpen(false);
        }
      });
    });
  }

  bindEmailForms();
  bindEmailPopups();
})();
