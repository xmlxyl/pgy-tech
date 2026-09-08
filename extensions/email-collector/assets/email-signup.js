(function () {
  /** @param {HTMLElement} form @param {string} key */
  function readFormMessage(form, key, fallback) {
    const fromNode = form
      .querySelector(`[data-pgy-email-i18n] [data-key="${key}"]`)
      ?.textContent?.trim();
    if (fromNode) return fromNode;
    const attr = form.getAttribute(`data-msg-${key}`);
    if (attr) return normalizeMessage(attr);
    return fallback;
  }

  /** @param {string | undefined | null} value */
  function normalizeMessage(value) {
    if (!value) return "";
    let decoded = String(value)
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16)),
      )
      .replace(/&amp;/g, "&")
      .replace(/&#39;|&apos;|&#x27;/gi, "'")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
    if (decoded.indexOf("&") === -1) return decoded;
    const textarea = document.createElement("textarea");
    textarea.innerHTML = decoded;
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
        success: readFormMessage(
          form,
          "success",
          "Thanks! You're subscribed.",
        ),
        already: readFormMessage(form, "already", "Already subscribed."),
        errorInvalid: readFormMessage(
          form,
          "error-invalid",
          "Please enter a valid email address.",
        ),
        errorGeneric: readFormMessage(
          form,
          "error-generic",
          "Something went wrong. Please try again.",
        ),
        errorPreview: readFormMessage(
          form,
          "error-preview",
          "请在店铺前台页面测试（打开在线商店），主题编辑器预览不支持提交。",
        ),
      };

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!proxyUrl) return;

        const emailInput =
          form.querySelector("[data-pgy-email-field]") ||
          form.querySelector('input[type="email"]');
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
      const emailInput =
        root.querySelector("[data-pgy-email-field]") ||
        root.querySelector('input[type="email"]');

      if (!openBtn || !overlay || !sheet) return;

      let closeTimer = 0;
      let closeGeneration = 0;

      const setOpen = (open) => {
        if (open) {
          closeGeneration += 1;
          if (closeTimer) {
            window.clearTimeout(closeTimer);
            closeTimer = 0;
          }

          if (overlay.parentElement !== document.body) {
            document.body.appendChild(overlay);
          }
          if (sheet.parentElement !== document.body) {
            document.body.appendChild(sheet);
          }

          overlay.hidden = false;
          sheet.hidden = false;
          // Force layout so the closed transform is painted before opening.
          void sheet.offsetWidth;

          root.classList.add("is-open");
          overlay.classList.add("is-open");
          sheet.classList.add("is-open");
          openBtn.setAttribute("aria-expanded", "true");
          document.body.classList.add("pgy-email-popup-lock");
          window.setTimeout(() => emailInput?.focus(), 320);
          return;
        }

        if (!root.classList.contains("is-open") && !sheet.classList.contains("is-open")) {
          return;
        }

        const generation = ++closeGeneration;
        root.classList.remove("is-open");
        overlay.classList.remove("is-open");
        sheet.classList.remove("is-open");
        openBtn.setAttribute("aria-expanded", "false");
        document.body.classList.remove("pgy-email-popup-lock");

        const finishClose = () => {
          if (generation !== closeGeneration) return;
          closeTimer = 0;
          sheet.removeEventListener("transitionend", onTransitionEnd);
          overlay.hidden = true;
          sheet.hidden = true;
          if (overlay.parentElement !== root) root.appendChild(overlay);
          if (sheet.parentElement !== root) root.appendChild(sheet);
        };

        const onTransitionEnd = (event) => {
          if (event.target !== sheet || event.propertyName !== "transform") {
            return;
          }
          finishClose();
        };

        sheet.addEventListener("transitionend", onTransitionEnd);
        closeTimer = window.setTimeout(finishClose, 400);
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
