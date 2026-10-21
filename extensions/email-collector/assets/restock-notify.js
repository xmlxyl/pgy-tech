(function () {
  var products = new WeakMap();

  function q(root, selector) {
    return root ? root.querySelector(selector) : null;
  }

  function text(form, key) {
    var node = form.querySelector('[data-key="' + key + '"]');
    return node && node.textContent ? node.textContent.trim() : "";
  }

  function show(el, value, isError) {
    if (!el) return;
    el.textContent = value || "";
    el.hidden = !value;
    el.classList.toggle("pgy-restock__message--error", Boolean(isError && value));
    el.classList.toggle("pgy-restock__message--success", Boolean(!isError && value));
  }

  function productOf(root) {
    var cached = products.get(root);
    if (cached) return cached;
    var product = { variants: [] };
    try { product = JSON.parse(q(root, "[data-pgy-restock-product]").textContent); } catch (error) {}
    product.variants = product.variants || [];
    products.set(root, product);
    return product;
  }

  function sectionOf(root) {
    return root.closest(".shopify-section") || document;
  }

  var syncing = 0;

  function syncNotify() {
    if (syncing) return;
    syncing = 1;
    document.querySelectorAll("[data-pgy-restock]").forEach(function (root) {
      var button = root.querySelector("[data-add-to-cart], button[name='add']") || addControl(root);
      var variant = variantOf(root);
      var stockout = !!(variant && variant.available !== false && variant.policy === "continue" && variant.qty <= 0);
      var on = !!(button && !button.disabled && !button.hasAttribute("unavailable") && (stockout || button.getAttribute("data-pre-order") === "true" || /pre-?order/i.test(button.textContent || "")));
      if (on && stockout && button) {
        var label = button.querySelector("[data-addtocart-text], [data-submit-button]");
        if (label && !/pre-?order/i.test(label.textContent || "")) label.textContent = "Pre-order now";
        if (button.getAttribute("data-pre-order") !== "true") button.setAttribute("data-pre-order", "true");
      }
      var trigger = q(root, "[data-pgy-restock-open]");
      var note = q(root, "[data-pgy-restock-note]");
      if (trigger) trigger.hidden = !on;
      if (note) note.hidden = !on;
      root.classList.add("is-ready");
      root.classList.toggle("is-preorder", on);
    });
    syncing = 0;
  }

  function addControl(root) {
    var nodes = sectionOf(root).querySelectorAll("[data-add-to-cart], button[name='add']");
    for (var i = 0; i < nodes.length; i += 1) {
      if (root.contains(nodes[i]) || nodes[i].closest(".shopify-payment-button")) continue;
      return nodes[i];
    }
    return null;
  }

  function variantOf(root) {
    var variants = productOf(root).variants;
    var input = sectionOf(root).querySelector("form[action*='/cart/add'] [name='id']");
    var id = (input && input.value) || new URLSearchParams(location.search).get("variant") || root.dataset.variantId || "";
    for (var i = 0; i < variants.length; i += 1) {
      if (String(variants[i].id) === String(id)) return variants[i];
    }
    return variants[0] || null;
  }

  function optionTitle(variant) {
    if (!variant || !variant.title || variant.title === "Default Title") return "";
    return variant.title;
  }

  function applyVariant(root, dialog) {
    var variant = variantOf(root);
    var title = optionTitle(variant);
    var label = q(dialog, "[data-pgy-restock-variant-label]");
    var image = q(dialog, "[data-pgy-restock-image]");
    var input = q(dialog, "[name='campaign_type']");
    if (label) {
      label.textContent = title;
      label.hidden = !title;
    }
    if (image && variant && variant.image) {
      image.hidden = false;
      image.src = variant.image;
    }
    if (input) {
      var base = (input.dataset.baseType || "").trim() || "Zipod Travel Tripod Kit";
      input.value = title ? base + " · " + title : base;
    }
    var variantIdInput = q(dialog, "[name='variant_id']");
    var variantTitleInput = q(dialog, "[name='variant_title']");
    if (variantIdInput) variantIdInput.value = variant && variant.id != null ? String(variant.id) : "";
    if (variantTitleInput) variantTitleInput.value = title;
  }

  function park(node) {
    if (!node || node.parentElement === document.body) return;
    if (node.id) {
      var existing = document.getElementById(node.id);
      if (existing && existing !== node) existing.remove();
    }
    document.body.appendChild(node);
  }

  function dock(root) {
    if (root.dataset.pgyRestockDocked === "true") return true;
    var row = q(root, "[data-pgy-restock-row]");
    var trigger = q(root, "[data-pgy-restock-open]");
    var addButton = addControl(root);
    if (!row || !trigger || !addButton || !addButton.parentElement) return false;
    root.hidden = false;
    addButton.parentElement.insertBefore(root, addButton);
    row.insertBefore(addButton, trigger);
    root.classList.add("is-docked");
    root.dataset.pgyRestockDocked = "true";
    return true;
  }

  function bind(root) {
    if (root.dataset.pgyRestockBound === "true") return;
    var dialog = document.getElementById(root.dataset.dialogId);
    var trigger = q(root, "[data-pgy-restock-open]");
    var form = q(dialog, "[data-pgy-restock-form]");
    if (!dialog || !trigger || !form) return;
    root.dataset.pgyRestockBound = "true";

    var overlay = q(root, ".pgy-restock__overlay");
    var emailInput = q(form, "[data-pgy-restock-email]");
    var messageEl = q(form, "[data-pgy-restock-message]");
    var submitBtn = q(form, "[type='submit']");
    var s = {
      ok: text(form, "success"),
      already: text(form, "already"),
      bad: text(form, "error-invalid"),
      fail: text(form, "error-generic"),
      preview: text(form, "error-preview"),
    };
    var closeTimer = 0;
    var tries = 0;

    if (overlay) overlay.dataset.sectionId = dialog.dataset.sectionId || "";
    park(overlay);
    park(dialog);
    applyVariant(root, dialog);
    var timer = setInterval(function () {
      tries += 1;
      dock(root);
      hookApply();
      syncNotify();
      if (tries > 40) clearInterval(timer);
    }, 250);

    function setOpen(open) {
      if (closeTimer) clearTimeout(closeTimer);
      if (open) {
        applyVariant(root, dialog);
        if (overlay) overlay.hidden = false;
        dialog.hidden = false;
      }
      if (overlay) overlay.classList.toggle("is-open", open);
      dialog.classList.toggle("is-open", open);
      trigger.setAttribute("aria-expanded", open ? "true" : "false");
      document.body.classList.toggle("pgy-restock-lock", open);
      if (open) return;
      closeTimer = setTimeout(function () {
        if (dialog.classList.contains("is-open")) return;
        if (overlay) overlay.hidden = true;
        dialog.hidden = true;
      }, 200);
      trigger.focus();
    }

    trigger.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(true);
    });
    dialog.addEventListener("click", function (event) {
      if (event.target.closest("[data-pgy-restock-close]")) setOpen(false);
    });
    if (overlay) overlay.addEventListener("click", function () { setOpen(false); });

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      applyVariant(root, dialog);
      var email = emailInput ? emailInput.value.trim() : "";
      if (!email || (emailInput && !emailInput.checkValidity())) {
        show(messageEl, s.bad, true);
        return;
      }
      var proxyUrl = form.dataset.proxyUrl;
      if (!proxyUrl) return;
      if (submitBtn) submitBtn.disabled = true;
      try {
        var params = new URLSearchParams(new FormData(form));
        params.set("email", email);
        var response = await fetch(proxyUrl + (proxyUrl.indexOf("?") === -1 ? "?" : "&") + params, {
          headers: { Accept: "application/json" },
        });
        var data = await response.json().catch(function () { return null; });
        if (response.ok && data && data.ok) {
          show(messageEl, data.alreadySubscribed ? s.already : s.ok, false);
          if (!data.alreadySubscribed && emailInput) emailInput.value = "";
        } else {
          show(messageEl, response.status === 401 ? s.preview : ((data && data.error) || s.fail), true);
        }
      } catch (error) {
        show(messageEl, s.preview, true);
      }
      if (submitBtn) submitBtn.disabled = false;
    });
  }

  function init() {
    document.querySelectorAll("[data-pgy-restock]").forEach(bind);
  }

  function sync(event) {
    var onlyOpen = event.type === "change";
    syncNotify();
    document.querySelectorAll("[data-pgy-restock]").forEach(function (root) {
      var dialog = document.getElementById(root.dataset.dialogId);
      if (!dialog || (onlyOpen && !dialog.classList.contains("is-open"))) return;
      applyVariant(root, dialog);
    });
  }

  ["change", "variant:change", "variant:update"].forEach(function (name) {
    document.addEventListener(name, sync);
  });
  document.addEventListener("shopify:section:load", init);
  document.addEventListener("shopify:section:unload", function (event) {
    var id = event.detail && event.detail.sectionId;
    if (!id) return;
    document.querySelectorAll("[data-section-id='" + id + "']").forEach(function (node) { node.remove(); });
  });

  function hookApply() {
    var apply = window.pgyApplyPreorderButtons;
    if (!apply || apply.pgy) return;
    window.pgyApplyPreorderButtons = function () {
      apply.apply(null, arguments);
      syncNotify();
    };
    window.pgyApplyPreorderButtons.pgy = 1;
  }
  hookApply();

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
