"use strict";

(function () {
  var debug = (window.__pgyFreeGiftDebug = {
    config: null,
    events: [],
    lastCart: null,
    lastError: null,
    started: false,
    hasRoot: false,
    version: "pgy-free-gift-checkout-2026-07-27-1",
  });
  var root = document.querySelector("[data-pgy-free-gift]");

  logDebug("loaded", {
    hasRoot: !!root,
    readyState: document.readyState,
    scripts: document.querySelectorAll('script[src*="free-gift"]').length,
  });

  if (!root) {
    logDebug("waiting-root");
    waitForRoot();
    return;
  }

  startFreeGift(root);

  function logDebug(label, detail) {
    debug.events.push({
      label: label,
      detail: detail || null,
      at: new Date().toISOString(),
    });
    if (debug.events.length > 30) debug.events.shift();
    console.log("[PGY free gift] " + label, detail || "");
  }

  function waitForRoot() {
    var observer;

    function tryStart() {
      var element = document.querySelector("[data-pgy-free-gift]");

      if (!element) return;

      if (observer) observer.disconnect();
      startFreeGift(element);
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", tryStart, { once: true });
    }

    observer = new MutationObserver(tryStart);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  function startFreeGift(root) {
    if (!root || root.dataset.pgyFreeGiftBound === "true") return;

    root.dataset.pgyFreeGiftBound = "true";

    var config = readConfig(root);
    debug.config = config;
    debug.hasRoot = true;
    debug.started = true;

    logDebug("init", {
      enabled: config.enabled,
      variantId: config.variantId,
      available: config.available,
      thresholdCents: config.thresholdCents,
    });

    if (!config.enabled || !config.variantId) {
      logDebug("disabled", {
        enabled: config.enabled,
        variantId: config.variantId,
        available: config.available,
      });
      syncComboDiscountAttribute().catch(function (error) {
        debug.lastError = error;
        console.warn(
          "[PGY free gift] Unable to sync combo discount switch.",
          error,
        );
      });
      return;
    }

    var state = {
      syncing: false,
      ensuringCheckout: false,
      syncTimer: null,
      fallbackTimer: null,
    };
    var defaultSections = [
      "cart-drawer",
      "cart-icon-bubble",
      "cart-live-region-text",
    ];
    var cartLineSelector = [
      "tr",
      "li",
      "cart-item",
      ".cart-item",
      ".cart__item",
      "[data-cart-item]",
    ].join(",");
    var sectionTargets = {
      "cart-drawer": [
        "#CartDrawer .drawer__inner",
        ".cart-drawer .drawer__inner",
        "cart-drawer .drawer__inner",
        "#CartDrawer .cart-drawer__items",
        ".cart-drawer .cart-drawer__items",
      ],
      "ajax-cart-drawer": ["[data-cart-drwaer-body]", "[data-cart-wrapper]"],
      "cart-icon-bubble": ["#cart-icon-bubble", ".cart-count-bubble"],
      "main-cart-items": ["cart-items", "#main-cart-items", ".cart__items"],
      "main-cart-footer": ["#main-cart-footer", ".cart__footer"],
      "cart-live-region-text": ["#cart-live-region-text"],
    };

    patchFetch();
    removeReminders();
    observeDom();
    bindCartEvents();
    bindCheckoutEvents();
    syncCart();

    function readConfig(element) {
      return {
        enabled: element.dataset.enabled === "true",
        thresholdCents: toNumber(element.dataset.thresholdCents),
        variantId: toNumber(element.dataset.giftVariantId),
        variantPriceCents: toNumber(element.dataset.giftVariantPriceCents),
        available: element.dataset.giftAvailable === "true",
        giftTitle: element.dataset.giftTitle || "Free gift",
        giftHandle: element.dataset.giftHandle || "",
        propertyName: element.dataset.propertyName || "_pgy_free_gift",
        propertyValue: element.dataset.propertyValue || "free",
        comboDiscountEnabled: element.dataset.comboDiscountEnabled !== "false",
        messages: {
          progress:
            element.dataset.msgProgress || "Spend more to unlock a free gift.",
          unlocked: element.dataset.msgUnlocked || "Free gift unlocked.",
          added: element.dataset.msgAdded || "Free gift added to your cart.",
          removed:
            element.dataset.msgRemoved ||
            "Free gift removed because the cart is below the threshold.",
          locked:
            element.dataset.msgLocked || "Free gift quantity is fixed at 1.",
        },
      };
    }

    async function syncCart(options) {
      options = options || {};

      if (state.syncing) return;
      state.syncing = true;

      try {
        var cart = await fetchCart();
        await syncComboDiscountAttribute(cart);
        var giftLines = cart.items.filter(isGiftLine);
        var subtotal = getSubtotalWithoutGift(cart.items);
        var unlocked = subtotal >= config.thresholdCents;

        debug.lastCart = cart;
        logDebug("sync", {
          itemCount: cart.item_count,
          subtotal: subtotal,
          thresholdCents: config.thresholdCents,
          unlocked: unlocked,
          giftLines: giftLines.length,
        });

        removeReminders();
        decorateGiftLines();

        if (unlocked && giftLines.length === 0) {
          var addedCart = await addGift();

          await notifyCartChanged(addedCart);
          debounceSync({ quiet: true });
          return;
        }

        if (!unlocked && giftLines.length) {
          removeGiftLinesOptimistically();

          var removedCart = await updateGiftLines(toQuantityMap(giftLines, 0));

          await notifyCartChanged(removedCart);
          debounceSync({ quiet: true });
          return;
        }

        var wrongQuantityLines = giftLines.filter(function (item) {
          return item.quantity !== 1;
        });

        if (wrongQuantityLines.length) {
          var updatedCart = await updateGiftLines(
            toQuantityMap(wrongQuantityLines, 1),
          );

          await notifyCartChanged(updatedCart);
          debounceSync({ quiet: true });
        }
      } catch (error) {
        removeReminders();
        debug.lastError = error;
        await restoreCartUi();
        console.warn("[PGY free gift] Unable to sync cart.", error);
      } finally {
        state.syncing = false;
      }
    }

    function debounceSync(options) {
      options = options || {};
      window.clearTimeout(state.syncTimer);
      state.syncTimer = window.setTimeout(
        function () {
          syncCart(options);
        },
        options.immediate ? 0 : 60,
      );
    }

    function getSubtotalWithoutGift(items) {
      return items.reduce(function (total, item) {
        return isGiftLine(item)
          ? total
          : total +
              toNumber(
                item.final_line_price == null
                  ? item.line_price
                  : item.final_line_price,
              );
      }, 0);
    }

    function isGiftLine(item) {
      return Number(item.variant_id) === config.variantId;
    }

    function toQuantityMap(items, quantity) {
      return items.reduce(function (updates, item) {
        updates[item.key] = quantity;
        return updates;
      }, {});
    }

    async function fetchCart() {
      var response = await fetch("/cart.js", {
        headers: { Accept: "application/json" },
        credentials: "same-origin",
      });

      if (!response.ok) throw new Error("Failed to load cart.");
      return response.json();
    }

    function addGift() {
      var updates = {};
      var attributes = {};

      updates[config.variantId] = 1;
      attributes[config.propertyName + "_variant_id"] = String(
        config.variantId,
      );
      attributes[config.propertyName] = config.propertyValue;
      attributes._pgy_combo_discount_enabled = config.comboDiscountEnabled
        ? "true"
        : "false";

      return updateGiftLines(updates, attributes);
    }

    async function syncComboDiscountAttribute(cart) {
      cart = cart || (await fetchCart());

      var attributes = cart.attributes || {};
      var nextValue = config.comboDiscountEnabled ? "true" : "false";

      if (attributes._pgy_combo_discount_enabled === nextValue) return cart;

      return updateCartAttributes({
        _pgy_combo_discount_enabled: nextValue,
      });
    }

    async function updateCartAttributes(attributes) {
      var response = await fetch("/cart/update.js", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({
          attributes: attributes,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to update cart attributes.");
      }

      return response.json();
    }

    async function updateGiftLines(updates, attributes) {
      var body = { updates: updates };

      if (attributes) body.attributes = attributes;
      addSectionRendering(body);

      var response = await fetch("/cart/update.js", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        var text = await response.text();

        logDebug("update failed", {
          status: response.status,
          body: body,
          response: text,
        });
        throw new Error("Failed to update free gift: " + text);
      }

      logDebug("update success", body);
      return response.json();
    }

    function addSectionRendering(body) {
      var sections = getCartSections();

      if (!sections.length) return;

      body.sections = sections;
      body.sections_url = window.location.pathname;
    }

    function getCartSections(options) {
      options = options || {};

      var sections = [];

      function add(sectionId) {
        if (!sectionId || sections.indexOf(sectionId) !== -1) return;
        if (options.skipDrawer && isDrawerSection(sectionId)) return;
        sections.push(sectionId);
      }

      document
        .querySelectorAll("cart-drawer, cart-notification, [data-cart-wrapper]")
        .forEach(function (element) {
          if (typeof element.getSectionsToRender !== "function") return;

          try {
            element.getSectionsToRender().forEach(function (section) {
              add(section && section.id);
            });
          } catch (error) {
            console.warn(
              "[PGY free gift] Unable to read theme cart sections.",
              error,
            );
          }
        });

      if (document.querySelector("[data-cart-drwaer-body]")) {
        add("ajax-cart-drawer");
      }

      defaultSections.forEach(add);

      if (isCartPage()) {
        add("main-cart-items");
        add("main-cart-footer");
      }

      return sections.slice(0, 5);
    }

    function removeReminders() {
      document
        .querySelectorAll(
          ".pgy-free-gift-banner, .pgy-free-gift-toast, .pgy-free-gift-loading-line",
        )
        .forEach(function (element) {
          element.remove();
        });
    }

    function getCartScopes() {
      var scopes = [];

      [
        "[data-cart-drwaer-body]",
        "[data-cart-wrapper]",
        "cart-drawer",
        "#CartDrawer",
        ".cart-drawer",
        ".mini-cart",
        ".ajaxcart",
        "cart-items",
        "form[action='/cart']",
        "form[action*='/cart']",
      ].forEach(function (selector) {
        document.querySelectorAll(selector).forEach(function (scope) {
          if (scopes.indexOf(scope) === -1) scopes.push(scope);
        });
      });

      return scopes;
    }

    function removeGiftLinesOptimistically() {
      getGiftLineElements().forEach(function (line) {
        line.classList.add("pgy-free-gift-line--removing");
        window.setTimeout(function () {
          if (line.parentElement) line.remove();
        }, 0);
      });
    }

    function getGiftLineElements() {
      var lines = [];

      getCartScopes().forEach(function (scope) {
        addUniqueLines(lines, scope.querySelectorAll(".pgy-free-gift-line"));

        if (config.giftHandle) {
          addUniqueLines(
            lines,
            scope.querySelectorAll(
              'a[href*="/products/' + config.giftHandle + '"]',
            ),
          );
        }

        addUniqueLines(
          lines,
          scope.querySelectorAll('a[href*="variant=' + config.variantId + '"]'),
        );
        addUniqueLines(
          lines,
          scope.querySelectorAll('[data-variant="' + config.variantId + '"]'),
        );
      });

      return lines;
    }

    function addUniqueLines(lines, elements) {
      elements.forEach(function (element) {
        var line = element.closest
          ? element.closest(cartLineSelector)
          : element;

        if (line && lines.indexOf(line) === -1) lines.push(line);
      });
    }

    function decorateGiftLines() {
      document
        .querySelectorAll(".pgy-free-gift-badge")
        .forEach(function (badge) {
          if (
            !badge.closest(
              "[data-cart-wrapper], [data-cart-drwaer-body], cart-drawer, #CartDrawer, .cart-drawer, .mini-cart, .ajaxcart, cart-items, form[action*='/cart']",
            )
          ) {
            badge.remove();
          }
        });

      getGiftLineElements().forEach(function (line) {
        line.classList.add("pgy-free-gift-line");
        lockGiftLineControls(line);

        var badge =
          line.querySelector(".pgy-free-gift-badge") ||
          createSpan("pgy-free-gift-badge", "FREE");
        var container =
          line.querySelector(
            ".cart-item-media, .cart-item__media, .line-item__media, .cart__image, .media",
          ) || line;

        badge.classList.add("pgy-free-gift-badge--media");
        container.classList.add("pgy-free-gift-media");
        if (badge.parentElement !== container) container.appendChild(badge);
      });
    }

    function lockGiftLineControls(line) {
      line
        .querySelectorAll('input[name^="updates"], input[type="number"]')
        .forEach(function (input) {
          input.value = "1";
          input.readOnly = true;
          input.disabled = true;
          input.tabIndex = -1;
          input.setAttribute("aria-hidden", "true");
          input.setAttribute("aria-label", "Free gift quantity fixed at 1");
        });

      line
        .querySelectorAll(
          ".quantity-button, [data-quantity-decrement], [data-quantity-increment]",
        )
        .forEach(function (control) {
          control.tabIndex = -1;
          control.setAttribute("aria-hidden", "true");
          control.setAttribute("disabled", "disabled");
        });
    }

    function bindCartEvents() {
      document.addEventListener("change", onCartInteraction);
      document.addEventListener("click", onCartInteraction);

      [
        "cart:updated",
        "cart:refresh",
        "theme:cart:change",
        "ajaxCart:updated",
        "cart-drawer:updated",
      ].forEach(function (eventName) {
        document.addEventListener(eventName, function () {
          debounceSync({ quiet: true });
        });
      });
    }

    function onCartInteraction(event) {
      if (
        event.target &&
        event.target.closest &&
        event.target.closest(".pgy-free-gift-line") &&
        event.target.closest(
          "input, [data-quantity-input], [data-quantity-decrement], [data-quantity-increment]",
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (
        event.target &&
        event.target.closest &&
        event.target.closest(
          "#ajax-cart-drawer, [data-cart-drwaer-body], [data-cart-wrapper], cart-drawer, #CartDrawer, .cart-drawer, form[action*='/cart'], .cart, .mini-cart",
        )
      ) {
        debounceSync();
      }
    }

    var buyNowSelector = [
      "[data-buy-now]",
      '[data-action="buy-now"]',
      ".buy-now",
      ".buy_now",
      ".product-buy-now",
      'button[name="buy"]',
      "[data-sbb-shop-now]",
      ".shopify-payment-button",
      '[data-shopify="payment-button"]',
      "shopify-accelerated-checkout",
    ].join(",");

    function bindCheckoutEvents() {
      document.addEventListener(
        "mousedown",
        function (event) {
          var trigger = getCheckoutTrigger(event.target);

          if (trigger) prepareCheckout(event, trigger);
        },
        true,
      );

      document.addEventListener(
        "click",
        function (event) {
          var trigger = getCheckoutTrigger(event.target);

          if (trigger) prepareCheckout(event, trigger);
        },
        true,
      );

      document.addEventListener(
        "submit",
        function (event) {
          var form = event.target;

          if (!form || !form.matches) return;

          var submitter = event.submitter || null;
          var checkoutSubmit =
            (submitter &&
              submitter.getAttribute &&
              submitter.getAttribute("name") === "checkout") ||
            form.querySelector('[name="checkout"]');

          if (
            !checkoutSubmit &&
            !isCartScope(form) &&
            !findBuyNowButton(submitter || form)
          ) {
            return;
          }

          prepareCheckout(event, checkoutSubmit || submitter || form);
        },
        true,
      );
    }

    function prepareCheckout(event, trigger) {
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();

      if (state.ensuringCheckout) return;

      handleCheckout(trigger);
    }

    async function handleCheckout(trigger) {
      var checkoutUrl = getCheckoutUrl(trigger);
      var buyNow = isBuyNowTrigger(trigger);
      var navigated = false;

      state.ensuringCheckout = true;
      setTriggerLoading(trigger, true);

      try {
        if (buyNow) {
          await addBuyNowProductToCart(trigger);
        }

        await ensureGiftInCart();

        logDebug("checkout-ready", {
          url: checkoutUrl,
          buyNow: buyNow,
        });

        navigated = true;
        window.location.assign(checkoutUrl);
      } catch (error) {
        debug.lastError = error;
        console.warn("[PGY free gift] Unable to prepare checkout gift.", error);

        navigated = true;
        window.location.assign(checkoutUrl);
      } finally {
        state.ensuringCheckout = false;
        if (!navigated) setTriggerLoading(trigger, false);
      }
    }

    async function ensureGiftInCart() {
      var cart = await fetchCart();
      await syncComboDiscountAttribute(cart);
      var subtotal = getSubtotalWithoutGift(cart.items || []);
      var giftLines = (cart.items || []).filter(isGiftLine);
      var unlocked = subtotal >= config.thresholdCents;

      logDebug("checkout-ensure", {
        subtotal: subtotal,
        thresholdCents: config.thresholdCents,
        unlocked: unlocked,
        giftLines: giftLines.length,
      });

      if (!unlocked) {
        if (giftLines.length) {
          await updateGiftLines(toQuantityMap(giftLines, 0));
        }
        return;
      }

      if (!giftLines.length) {
        await addGift();
        cart = await fetchCart();
        giftLines = (cart.items || []).filter(isGiftLine);
      }

      var wrongQuantityLines = giftLines.filter(function (item) {
        return item.quantity !== 1;
      });

      if (wrongQuantityLines.length) {
        await updateGiftLines(toQuantityMap(wrongQuantityLines, 1));
        cart = await fetchCart();
        giftLines = (cart.items || []).filter(isGiftLine);
      }

      if (!giftLines.length) {
        throw new Error("Gift variant " + config.variantId + " was not added.");
      }
    }

    async function addBuyNowProductToCart(trigger) {
      var permalink = parseCartPermalink(
        (trigger && trigger.getAttribute && trigger.getAttribute("href")) ||
          (trigger && trigger.href),
      );

      if (permalink && permalink.variantId) {
        await fetchJson("/cart/add.js", {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          credentials: "same-origin",
          body: JSON.stringify({
            items: [
              {
                id: permalink.variantId,
                quantity: permalink.quantity,
              },
            ],
          }),
        });
        return;
      }

      if (
        trigger &&
        trigger.closest &&
        trigger.closest("[data-sbb-shop-now]")
      ) {
        await addSummerBackpackBundleToCart(trigger);
        return;
      }

      var form = getBuyNowProductForm(trigger);
      var formData = form
        ? new FormData(form)
        : buildBuyNowFallbackFormData(trigger);

      if (!formData) {
        throw new Error("Unable to find the Buy Now product variant.");
      }

      formData.delete("sections");
      formData.delete("sections_url");

      if (!toNumber(formData.get("id"))) {
        throw new Error("Unable to read the selected Buy Now variant.");
      }

      await fetchJson("/cart/add.js", {
        method: "POST",
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        body: formData,
      });
    }

    async function addSummerBackpackBundleToCart(trigger) {
      var row = trigger.closest("[data-sbb-row]");
      var cartSelection = getSummerBackpackSelectedItems(row);

      if (!cartSelection.length) {
        throw new Error("Unable to find selected bundle variants.");
      }

      logDebug("buy-now-sbb-items", {
        items: cartSelection,
      });

      await fetchJson(
        typeof cartAddUrl !== "undefined" ? cartAddUrl : "/cart/add.js",
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-Requested-With": "XMLHttpRequest",
          },
          credentials: "same-origin",
          body: JSON.stringify({
            items: cartSelection,
          }),
        },
      );
    }

    function getSummerBackpackSelectedItems(row) {
      if (!row) return [];

      var itemsById = {};
      var items = [];

      row.querySelectorAll("[data-sbb-card]").forEach(function (card) {
        var variant = getSummerBackpackSelectedVariant(card);

        if (!variant || !variant.id || variant.available === false) return;

        var variantId = String(variant.id);

        if (!itemsById[variantId]) {
          itemsById[variantId] = {
            id: Number(variant.id),
            quantity: 0,
          };
          items.push(itemsById[variantId]);
        }

        itemsById[variantId].quantity += 1;
      });

      return items;
    }

    function getSummerBackpackSelectedVariant(card) {
      var productData = parseJsonScript(
        card && card.querySelector("[data-sbb-product-json]"),
      );

      if (
        !productData ||
        !productData.variants ||
        !productData.variants.length
      ) {
        return null;
      }

      var select = card.querySelector("[data-sbb-sku-select]");
      var selectedId = select
        ? String(select.value)
        : String(card.getAttribute("data-selected-variant-id") || "");

      return (
        productData.variants.find(function (variant) {
          return String(variant.id) === selectedId;
        }) ||
        productData.variants.find(function (variant) {
          return variant.available;
        }) ||
        productData.variants[0] ||
        null
      );
    }

    function parseJsonScript(element) {
      if (!element) return null;

      try {
        return JSON.parse(element.textContent || "{}");
      } catch (error) {
        return null;
      }
    }

    async function fetchJson(url, options) {
      var response = await fetch(url, options || {});

      if (!response.ok) {
        throw new Error("Request failed: " + response.status);
      }

      return response.json();
    }

    function getCheckoutTrigger(element) {
      if (!element || !element.closest) return null;

      return (
        element.closest('[name="checkout"]') ||
        element.closest(".cart__checkout-button") ||
        element.closest(".cart-drawer__checkout-button") ||
        element.closest(".ajaxcart__checkout") ||
        element.closest("#checkout") ||
        element.closest("[data-checkout]") ||
        element.closest(".checkout-button") ||
        element.closest('a[href="/checkout"]') ||
        element.closest('a[href^="/checkout?"]') ||
        findBuyNowButton(element)
      );
    }

    function findBuyNowButton(element) {
      if (!element || !element.closest) return null;

      var candidate = element.closest(buyNowSelector);

      if (candidate) return candidate;

      var button = element.closest("button, a, input[type='submit']");

      if (!button) return null;

      if (parseCartPermalink(button.getAttribute("href") || button.href)) {
        return button;
      }

      return isBuyNowLabel(button) ? button : null;
    }

    function isBuyNowTrigger(trigger) {
      if (!trigger) return false;

      if (trigger.matches && trigger.matches(buyNowSelector)) return true;

      if (
        parseCartPermalink(
          (trigger.getAttribute && trigger.getAttribute("href")) ||
            trigger.href,
        )
      ) {
        return true;
      }

      return isBuyNowLabel(trigger);
    }

    function isBuyNowLabel(element) {
      var label = getButtonLabel(element);

      return (
        label.indexOf("buy it now") !== -1 ||
        label.indexOf("buy now") !== -1 ||
        label.indexOf("shop now") !== -1
      );
    }

    function getButtonLabel(element) {
      if (!element || !element.getAttribute) return "";

      return (
        element.getAttribute("aria-label") ||
        element.value ||
        element.textContent ||
        ""
      )
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
    }

    function getBuyNowProductForm(trigger) {
      if (!trigger) return null;

      if (trigger.form && hasVariantIdField(trigger.form)) {
        return trigger.form;
      }

      if (!trigger.closest) return null;

      var closestForm = trigger.closest("form");

      if (closestForm && hasVariantIdField(closestForm)) return closestForm;

      closestForm = trigger.closest('form[action*="/cart/add"]');
      if (closestForm) return closestForm;

      var formId = trigger.getAttribute && trigger.getAttribute("form");
      if (formId) {
        var linkedForm = document.getElementById(formId);

        if (linkedForm && hasVariantIdField(linkedForm)) {
          return linkedForm;
        }
      }

      var productScope = trigger.closest(
        "product-info, product-form, .product, .product-form, [data-product], [data-product-form]",
      );

      if (productScope) {
        var scopedForm =
          productScope.querySelector('form[action*="/cart/add"]') ||
          Array.prototype.find.call(
            productScope.querySelectorAll("form"),
            hasVariantIdField,
          );

        if (scopedForm) return scopedForm;
      }

      return Array.prototype.find.call(
        document.querySelectorAll('form[action*="/cart/add"], form'),
        hasVariantIdField,
      );
    }

    function buildBuyNowFallbackFormData(trigger) {
      var variantId = getSelectedVariantId(trigger);

      if (!variantId) return null;

      var formData = new FormData();
      var quantity = getSelectedQuantity(trigger);

      formData.set("id", String(variantId));
      if (quantity > 0) formData.set("quantity", String(quantity));

      logDebug("buy-now-fallback-variant", {
        variantId: variantId,
        quantity: quantity || 1,
      });

      return formData;
    }

    function getSelectedVariantId(trigger) {
      var scopes = getProductLookupScopes(trigger);

      for (var index = 0; index < scopes.length; index += 1) {
        var variantId = getVariantIdFromScope(scopes[index]);

        if (variantId) return variantId;
      }

      try {
        return toNumber(
          new URLSearchParams(window.location.search).get("variant"),
        );
      } catch (error) {
        return 0;
      }
    }

    function getVariantIdFromScope(scope) {
      if (!scope || !scope.querySelector) return 0;

      var selectedInput =
        scope.querySelector('select[name="id"]') ||
        scope.querySelector('input[name="id"]:checked') ||
        scope.querySelector('input[name="id"][value]');

      if (selectedInput) {
        return toNumber(selectedInput.value);
      }

      var variantElement = scope.querySelector(
        "[data-selected-variant-id], [data-current-variant-id], [data-variant-id]",
      );

      if (!variantElement) return 0;

      return toNumber(
        variantElement.dataset.selectedVariantId ||
          variantElement.dataset.currentVariantId ||
          variantElement.dataset.variantId,
      );
    }

    function getSelectedQuantity(trigger) {
      var scopes = getProductLookupScopes(trigger);

      for (var index = 0; index < scopes.length; index += 1) {
        var quantityInput =
          scopes[index] &&
          scopes[index].querySelector &&
          scopes[index].querySelector('[name="quantity"]');

        if (quantityInput && toNumber(quantityInput.value) > 0) {
          return toNumber(quantityInput.value);
        }
      }

      return 1;
    }

    function getProductLookupScopes(trigger) {
      var scopes = [];

      function add(scope) {
        if (scope && scopes.indexOf(scope) === -1) scopes.push(scope);
      }

      if (trigger) {
        add(trigger.form);

        if (trigger.getAttribute) {
          var formId = trigger.getAttribute("form");
          if (formId) add(document.getElementById(formId));
        }

        if (trigger.closest) {
          add(trigger.closest("form"));
          add(
            trigger.closest(
              "product-info, product-form, .product, .product-form, [data-product], [data-product-form]",
            ),
          );
        }
      }

      Array.prototype.forEach.call(
        document.querySelectorAll("form"),
        function (form) {
          if (hasVariantIdField(form)) add(form);
        },
      );

      add(document);

      return scopes;
    }

    function hasVariantIdField(scope) {
      return !!(
        scope &&
        scope.querySelector &&
        scope.querySelector('select[name="id"], input[name="id"]')
      );
    }

    function parseCartPermalink(href) {
      if (!href) return null;

      var match = String(href).match(/\/cart\/(\d+)(?::(\d+))?/i);

      if (!match) return null;

      return {
        variantId: toNumber(match[1]),
        quantity: toNumber(match[2]) || 1,
      };
    }

    function getCheckoutUrl(trigger) {
      if (trigger && trigger.tagName === "A" && trigger.href) {
        if (parseCartPermalink(trigger.href)) return "/checkout";
        if (/\/checkout/.test(trigger.href)) return trigger.href;
      }

      if (trigger && trigger.form && trigger.form.action) {
        if (/\/checkout/.test(trigger.form.action)) return trigger.form.action;
      }

      return "/checkout";
    }

    function isCartScope(element) {
      return !!(
        element &&
        element.closest &&
        element.closest(
          "#ajax-cart-drawer, [data-cart-drwaer-body], [data-cart-wrapper], cart-drawer, #CartDrawer, .cart-drawer, form[action*='/cart'], .cart, .mini-cart",
        )
      );
    }

    function setTriggerLoading(trigger, loading) {
      if (!trigger) return;

      if (loading) {
        trigger.classList.add("pgy-free-gift-checkout-loading");
        trigger.classList.add("is-loading");
        trigger.setAttribute("aria-busy", "true");
        trigger.setAttribute("aria-disabled", "true");

        if ("disabled" in trigger) {
          trigger.dataset.pgyWasDisabled = trigger.disabled ? "1" : "0";
          trigger.disabled = true;
        }

        return;
      }

      trigger.classList.remove("pgy-free-gift-checkout-loading");
      trigger.classList.remove("is-loading");
      trigger.removeAttribute("aria-busy");
      trigger.removeAttribute("aria-disabled");

      if ("disabled" in trigger) {
        trigger.disabled = trigger.dataset.pgyWasDisabled === "1";
        delete trigger.dataset.pgyWasDisabled;
      }
    }

    function observeDom() {
      new MutationObserver(function () {
        removeReminders();
        decorateGiftLines();
      }).observe(document.documentElement, { childList: true, subtree: true });
    }

    function patchFetch() {
      if (window.__pgyFreeGiftFetchPatched) return;

      window.__pgyFreeGiftFetchPatched = true;

      var originalFetch = window.fetch;

      window.fetch = async function () {
        var response = await originalFetch.apply(this, arguments);
        var url = String(
          (arguments[0] && (arguments[0].url || arguments[0])) || "",
        );

        if (/\/cart\/(add|change|update|clear)(\.js)?(?:[?#].*)?$/.test(url)) {
          scheduleFallbackCartRefresh();
          debounceSync({ quiet: true, immediate: true });
        }

        return response;
      };
    }

    function scheduleFallbackCartRefresh() {
      window.clearTimeout(state.fallbackTimer);
      state.fallbackTimer = window.setTimeout(async function () {
        try {
          var cart = await fetchCart();

          updateHeaderCartCount(cart.item_count);
          await refreshCartUi(null);
        } catch (error) {
          console.warn(
            "[PGY free gift] Unable to run fallback cart refresh.",
            error,
          );
        }
      }, 350);
    }

    async function notifyCartChanged(cartState, options) {
      options = options || {};

      window.clearTimeout(state.fallbackTimer);
      if (cartState && cartState.item_count != null) {
        updateHeaderCartCount(cartState.item_count);
      }
      await refreshCartUi(cartState, options);
      removeReminders();

      var detail = {
        cart: cartState || null,
        source: "pgy-free-gift",
      };

      [
        "cart:refresh",
        "cart:updated",
        "theme:cart:change",
        "cart-drawer:updated",
      ].forEach(function (eventName) {
        document.dispatchEvent(new CustomEvent(eventName, { detail: detail }));
      });
      window.dispatchEvent(
        new CustomEvent("pgy:free-gift:changed", { detail: detail }),
      );
    }

    async function refreshCartUi(cartState, options) {
      options = options || {};

      if (!cartState || !cartState.sections) {
        cartState = await fetchCartSections(options);
      }

      if (!cartState || !cartState.sections) return;

      renderSections(cartState.sections, options);
      removeReminders();
      decorateGiftLines();
    }

    async function restoreCartUi() {
      try {
        await refreshCartUi(null);
      } catch (error) {
        console.warn("[PGY free gift] Unable to restore cart UI.", error);
      }
    }

    async function fetchCartSections(options) {
      var sections = getCartSections(options);

      if (!sections.length) return null;

      var response = await fetch(
        "/cart?sections=" +
          encodeURIComponent(sections.join(",")) +
          "&sections_url=" +
          encodeURIComponent(window.location.pathname),
        {
          headers: { Accept: "application/json" },
          credentials: "same-origin",
        },
      );

      if (!response.ok) throw new Error("Failed to refresh cart sections.");

      return {
        sections: await response.json(),
      };
    }

    function renderSections(sections, options) {
      Object.keys(sections).forEach(function (sectionId) {
        var html = sections[sectionId];

        if (!html || shouldSkipSection(sectionId, options)) return;

        renderSection(sectionId, html);
      });
    }

    function shouldSkipSection(sectionId, options) {
      options = options || {};

      if (options.skipDrawer && isDrawerSection(sectionId)) return true;

      return (
        !isCartPage() &&
        (sectionId === "main-cart-items" || sectionId === "main-cart-footer")
      );
    }

    function renderSection(sectionId, html) {
      var parsed = new DOMParser().parseFromString(html, "text/html");

      if (sectionId === "cart-drawer") {
        renderCartDrawer(parsed);
        return;
      }

      if (sectionId === "ajax-cart-drawer") {
        renderAjaxCartDrawer(parsed);
        return;
      }

      if (sectionId === "cart-icon-bubble") {
        renderCartIconBubble(parsed);
        return;
      }

      var currentWrapper = document.getElementById(
        "shopify-section-" + sectionId,
      );
      var nextWrapper = parsed.getElementById("shopify-section-" + sectionId);

      if (currentWrapper && nextWrapper) {
        currentWrapper.innerHTML = nextWrapper.innerHTML;
        return;
      }

      var directCurrent = document.getElementById(sectionId);
      var directNext = parsed.getElementById(sectionId);

      if (directCurrent && directNext) {
        directCurrent.innerHTML = directNext.innerHTML;
        return;
      }

      replaceFirstMatching(sectionTargets[sectionId] || [], parsed);
    }

    function replaceFirstMatching(selectors, parsed) {
      for (var index = 0; index < selectors.length; index += 1) {
        var current = document.querySelector(selectors[index]);
        var next = parsed.querySelector(selectors[index]);

        if (current && next) {
          current.innerHTML = next.innerHTML;
          return true;
        }
      }

      return false;
    }

    function renderCartDrawer(parsed) {
      syncCartDrawerState(parsed);
      replaceFirstMatching(sectionTargets["cart-drawer"], parsed);
    }

    function renderAjaxCartDrawer(parsed) {
      var body = document.querySelector("[data-cart-drwaer-body]");
      var nextWrapper = parsed.querySelector(".shopify-section") || parsed.body;

      if (body && nextWrapper) {
        body.innerHTML = nextWrapper.innerHTML;
        rebindThemeCart(body);
        return;
      }

      replaceFirstMatching(sectionTargets["ajax-cart-drawer"], parsed);
      rebindThemeCart(document);
    }

    function renderCartIconBubble(parsed) {
      var currentIcon = document.getElementById("cart-icon-bubble");
      var nextIcon = parsed.getElementById("cart-icon-bubble");

      if (currentIcon && nextIcon) {
        currentIcon.innerHTML = nextIcon.innerHTML;
        return;
      }

      var currentBubble = document.querySelector(".cart-count-bubble");
      var nextBubble = parsed.querySelector(".cart-count-bubble");

      if (currentBubble && nextBubble) {
        currentBubble.innerHTML = nextBubble.innerHTML;
        return;
      }

      if (currentBubble && !nextBubble) currentBubble.remove();
    }

    function syncCartDrawerState(parsed) {
      var current = document.querySelector("cart-drawer");
      var next = parsed.querySelector("cart-drawer");

      syncEmptyClass(current, next);
      syncEmptyClass(
        document.querySelector("#CartDrawer, .cart-drawer"),
        parsed.querySelector("#CartDrawer, .cart-drawer"),
      );
    }

    function syncEmptyClass(current, next) {
      if (!current || !next) return;

      current.classList.toggle("is-empty", next.classList.contains("is-empty"));
    }

    function updateHeaderCartCount(itemCount) {
      itemCount = Number(itemCount || 0);

      if (typeof window.cartCountUpdate === "function") {
        try {
          window.cartCountUpdate(itemCount);
          return;
        } catch (error) {
          console.warn(
            "[PGY free gift] Unable to update theme cart count.",
            error,
          );
        }
      }

      document
        .querySelectorAll("[data-header-cart-count]")
        .forEach(function (el) {
          var icon = el.closest(".cart.header-icons-link");

          el.textContent = itemCount > 0 && itemCount <= 99 ? itemCount : "";
          el.classList.toggle("hidden", itemCount <= 0);
          if (icon) icon.classList.toggle("dot-icon", itemCount > 99);
        });
    }

    function rebindThemeCart(scope) {
      [
        "getAllDetails",
        "getQuantityElement",
        "cartNoteUpdate",
        "getCartItemRemoveElements",
        "SidedrawerEventInit",
        "cartGiftWrapElement",
        "cartTotalprice",
      ].forEach(function (name) {
        if (typeof window[name] !== "function") return;

        try {
          window[name](scope);
        } catch (error) {
          console.warn("[PGY free gift] Unable to rebind " + name + ".", error);
        }
      });
    }

    function isDrawerSection(sectionId) {
      return sectionId === "cart-drawer" || sectionId === "ajax-cart-drawer";
    }

    function createSpan(className, text) {
      var span = document.createElement("span");

      span.className = className;
      span.textContent = text;
      return span;
    }

    function isCartPage() {
      return window.location.pathname.replace(/\/+$/, "") === "/cart";
    }

    function isEmptyCart(cart) {
      return !!cart && Number(cart.item_count || 0) === 0;
    }

    function toNumber(value) {
      var number = Number(value);

      return Number.isFinite(number) ? number : 0;
    }

    function formatMessage(message, values) {
      return message.replace(/\{\{\s*(\w+)\s*\}\}/g, function (match, key) {
        return values[key] || "";
      });
    }

    function appendIfMissing(message, value) {
      return message.indexOf(value) === -1 ? message + " " + value : message;
    }

    function formatMoney(cents) {
      if (window.Shopify && typeof window.Shopify.formatMoney === "function") {
        return window.Shopify.formatMoney(cents);
      }

      var currency =
        (window.Shopify &&
          window.Shopify.currency &&
          window.Shopify.currency.active) ||
        document.documentElement.getAttribute("data-currency") ||
        "USD";

      try {
        return new Intl.NumberFormat(void 0, {
          style: "currency",
          currency: currency,
        }).format(cents / 100);
      } catch (error) {
        return "$" + (cents / 100).toFixed(2);
      }
    }
  }
})();
