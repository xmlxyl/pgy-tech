(function () {
  function showMessage(el, text, isError) {
    if (!el) return;
    el.textContent = text;
    el.hidden = !text;
    el.classList.toggle("pgy-email-signup__message--error", Boolean(isError));
    el.classList.toggle(
      "pgy-email-signup__message--success",
      !isError && Boolean(text),
    );
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

  document.querySelectorAll("[data-pgy-email-form]").forEach((form) => {
    if (form.dataset.pgyEmailBound === "true") return;
    form.dataset.pgyEmailBound = "true";

    const proxyUrl = form.dataset.proxyUrl;
    const messageEl = form.querySelector("[data-pgy-email-message]");
    const submitBtn = form.querySelector("[type=submit]");
    const strings = {
      success: form.dataset.msgSuccess || "Thanks!",
      errorInvalid: form.dataset.msgErrorInvalid || "Invalid email.",
      errorGeneric: form.dataset.msgErrorGeneric || "Something went wrong.",
      errorPreview:
        form.dataset.msgErrorPreview ||
        "请在店铺前台页面测试（打开在线商店），主题编辑器预览不支持提交。",
    };

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!proxyUrl) return;

      const emailInput = form.querySelector('input[name="email"]');
      const usernameInput = form.querySelector('input[name="username"]');
      const email = emailInput?.value?.trim() ?? "";
      const username = usernameInput?.value?.trim() ?? "";
      if (!email) {
        showMessage(messageEl, strings.errorInvalid, true);
        return;
      }

      showMessage(messageEl, "", false);
      if (submitBtn) submitBtn.disabled = true;

      try {
        const params = new URLSearchParams({ email });
        if (username) params.set("username", username);
        const url = `${proxyUrl}${proxyUrl.includes("?") ? "&" : "?"}${params}`;

        const response = await fetch(url, {
          method: "GET",
          headers: { Accept: "application/json" },
          credentials: "same-origin",
        });
        const data = await readJsonResponse(response);

        if (response.ok && data?.ok) {
          showMessage(messageEl, strings.success, false);
          if (emailInput) emailInput.value = "";
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
  });
})();
