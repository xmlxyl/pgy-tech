"use strict";

(function () {
  // Avoid Shopify.formatMoney crashes when money_format is missing/broken.
  window.Shopify = window.Shopify || {};
  if (
    !window.Shopify.money_format ||
    String(window.Shopify.money_format).indexOf("amount") === -1
  ) {
    window.Shopify.money_format = ["$", "{", "{", "amount", "}", "}"].join("");
  }

  var STORAGE_KEY = "pgy_tiered_gift_checkout";
  var CART_VISIT_KEY = "pgy_tiered_gift_cart";
  var debug = (window.__pgyTieredGiftDebug = {
    config: null,
    events: [],
    lastCart: null,
    lastError: null,
    started: false,
    version: "pgy-tiered-gift-checkout-2026-08-18-2",
  });

  var root = document.querySelector("[data-pgy-tiered-gift]");

  if (!root) {
    waitForRoot();
    return;
  }

  start(root);

  function log(label, detail) {
    debug.events.push({
      label: label,
      detail: detail || null,
      at: new Date().toISOString(),
    });
    if (debug.events.length > 40) debug.events.shift();
    console.log("[PGY tiered gift] " + label, detail || "");
  }

  function waitForRoot() {
    var observer = new MutationObserver(function () {
      var element = document.querySelector("[data-pgy-tiered-gift]");
      if (!element) return;
      observer.disconnect();
      start(element);
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  function start(root) {
    if (!root || root.dataset.pgyTieredGiftBound === "true") return;
    root.dataset.pgyTieredGiftBound = "true";

    var config = readConfig();
    debug.config = config;
    debug.started = true;

    if (!config.enabled || !config.tiers.length) {
      log("disabled", config);
      return;
    }

    var state = {
      cart: null,
      refreshing: false,
      ensuring: false,
      cleaning: false,
      timer: null,
      bannerText: "",
      bannerUnlocked: false,
      bannerFeatured: null,
    };

    observeGiftLineDom();

    boot();

    async function boot() {
      restoreMisplacedHides();

      try {
        if (isCartPage()) {
          sessionStorage.setItem(CART_VISIT_KEY, "1");
          var cart = await fetchCart();
          var attributes = cart.attributes || {};
          if (attributes._pgy_gift_discount_label !== config.discountLabel) {
            await fetchJson("/cart/update.js", {
              method: "POST",
              headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
              },
              credentials: "same-origin",
              body: JSON.stringify({
                attributes: {
                  _pgy_gift_discount_label: config.discountLabel,
                },
              }),
            });
          }
        } else {
          await cleanupGiftLines({ immediate: true });
        }
      } catch (error) {
        console.warn("[PGY tiered gift] Boot cleanup failed.", error);
      }

      bindCheckoutInterceptors();
      bindCartWatchers();
      bindReturnPageHandlers();
      refreshBanner();
    }

    function normalizeSku(value) {
      return String(value || "")
        .trim()
        .toLowerCase();
    }

    function findVariantBySku(variants, sku) {
      var skuKey = normalizeSku(sku);
      if (!skuKey || !variants || !variants.length) return null;

      return (
        variants.find(function (item) {
          return normalizeSku(item.sku) === skuKey;
        }) || null
      );
    }

    function normalizeTier(tier, fallbackTitle) {
      return {
        tierLevel: toNumber(tier.tierLevel),
        thresholdCents: toNumber(tier.thresholdCents),
        variantId: toNumber(tier.variantId),
        sku: String(tier.sku || "").trim(),
        title: tier.title || fallbackTitle || "Free gift",
        handle: (tier.handle || "").replace(/^\/+|\/+$/g, ""),
        image: tier.image || "",
      };
    }

    function readTierScripts(fallbackTitle) {
      return Array.from(
        document.querySelectorAll("script[data-pgy-tiered-gift-tier]"),
      )
        .map(function (node) {
          try {
            return normalizeTier(
              JSON.parse(node.textContent || "{}"),
              fallbackTitle,
            );
          } catch (error) {
            console.warn("[PGY tiered gift] Invalid tier JSON.", error);
            return null;
          }
        })
        .filter(function (tier) {
          return tier && (tier.variantId > 0 || !!tier.handle);
        });
    }

    function readConfig() {
      var script = document.querySelector("[data-pgy-tiered-gift-config]");
      var raw = {};

      if (script) {
        try {
          raw = JSON.parse(script.textContent || "{}");
        } catch (error) {
          console.warn("[PGY tiered gift] Invalid config JSON.", error);
        }
      }

      var fallbackTitle = raw.giftFallbackTitle || "Free gift";
      var tiers = [];

      if (raw.tiers && raw.tiers.length) {
        tiers = raw.tiers
          .map(function (tier) {
            return normalizeTier(tier, fallbackTitle);
          })
          .filter(function (tier) {
            return tier.variantId > 0 || !!tier.handle;
          });
      }

      if (!tiers.length) {
        tiers = readTierScripts(fallbackTitle);
      }

      tiers.sort(function (a, b) {
        if (a.tierLevel && b.tierLevel && a.tierLevel !== b.tierLevel) {
          return a.tierLevel - b.tierLevel;
        }

        return a.thresholdCents - b.thresholdCents;
      });

      return {
        enabled: raw.enabled !== false,
        propertyName: raw.propertyName || "_pgy_tiered_gift",
        propertyValue: raw.propertyValue || "free",
        discountLabel: String(raw.discountLabel || "BTSFREE").trim() || "BTSFREE",
        giftFallbackTitle: fallbackTitle,
        tiers: tiers,
        messages: {
          locked:
            (raw.messages && raw.messages.locked) ||
            "Free gift will be added at checkout.",
          unlocked:
            (raw.messages && raw.messages.unlocked) ||
            "Free gift unlocked: [title]",
          progress:
            (raw.messages && raw.messages.progress) ||
            "Spend [remaining] more to unlock [title]",
          empty:
            (raw.messages && raw.messages.empty) ||
            "Add items to unlock a free gift.",
        },
      };
    }

    function getActiveTier(subtotalCents) {
      var active = null;

      config.tiers.forEach(function (tier) {
        if (subtotalCents >= tier.thresholdCents) active = tier;
      });

      return active;
    }

    function getNextTier(subtotalCents) {
      for (var i = 0; i < config.tiers.length; i += 1) {
        if (subtotalCents < config.tiers[i].thresholdCents) {
          return config.tiers[i];
        }
      }

      return null;
    }

    async function ensureTierVariants() {
      await Promise.all(
        config.tiers.map(async function (tier) {
          if (tier.variantId > 0 && tier.image && !tier.sku) return;
          if (!tier.handle) return;

          try {
            var product = await fetchJson(
              "/products/" + encodeURIComponent(tier.handle) + ".js",
            );
            var variants = product.variants || [];
            var variant =
              findVariantBySku(variants, tier.sku) ||
              variants.find(function (item) {
                return tier.variantId > 0 && toNumber(item.id) === tier.variantId;
              }) ||
              variants.find(function (item) {
                return item.available;
              }) ||
              variants[0];

            if (variant) {
              tier.variantId = toNumber(variant.id);
              if (variant.sku) tier.sku = String(variant.sku).trim();

              var variantImage =
                variant.featured_image ||
                variant.image ||
                (variant.featured_image && variant.featured_image.src) ||
                "";
              if (variantImage) {
                tier.image = normalizeImageUrl(variantImage);
              }
            }

            if (tier.title == null || tier.title === "") {
              tier.title = product.title || tier.title;
            }

            if (!tier.image) {
              var featured =
                product.featured_image ||
                (product.images && product.images[0]) ||
                "";
              tier.image = normalizeImageUrl(featured);
            }
          } catch (error) {
            console.warn(
              "[PGY tiered gift] Unable to resolve handle " + tier.handle,
              error,
            );
          }
        }),
      );
    }

    function normalizeImageUrl(image) {
      if (!image) return "";
      if (typeof image === "string") {
        return image.indexOf("//") === 0 ? "https:" + image : image;
      }
      if (image.src) {
        return image.src.indexOf("//") === 0 ? "https:" + image.src : image.src;
      }
      return "";
    }

    function isGiftLine(item) {
      var props = item.properties || {};
      var labels = getGiftLabelKeys();

      if (hasGiftFlag(props[config.propertyName])) return true;
      if (hasGiftFlag(props._pgy_tiered_gift)) return true;
      if (hasGiftFlag(props._pgy_free_gift)) return true;

      if (
        Object.keys(props).some(function (key) {
          return (
            isGiftLabel(key, labels) || isGiftLabel(props[key], labels)
          );
        })
      ) {
        return true;
      }

      var discounts = item.discounts || [];
      if (
        discounts.some(function (discount) {
          return isGiftLabel(discount && discount.title, labels);
        })
      ) {
        return true;
      }

      return false;
    }

    function getGiftLabelKeys() {
      var labels = ["free", "btsfree"];
      var configured = String(config.discountLabel || "")
        .trim()
        .toLowerCase();

      if (configured && labels.indexOf(configured) === -1) {
        labels.push(configured);
      }

      return labels;
    }

    function isGiftLabel(value, labels) {
      var normalized = String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "");

      if (!normalized) return false;

      return (labels || getGiftLabelKeys()).some(function (label) {
        if (!label) return false;
        if (normalized === label) return true;
        if (normalized.indexOf(label) !== 0) return false;
        return /^\d/.test(normalized.slice(label.length));
      });
    }

    function hasGiftFlag(value) {
      return String(value || "").trim().toLowerCase() === config.propertyValue;
    }

    function giftAttributePayload(extra) {
      var attributes = {
        _pgy_tiered_gift: config.propertyValue,
        _pgy_free_gift: config.propertyValue,
        _pgy_gift_discount_label: config.discountLabel,
      };

      if (extra) {
        Object.keys(extra).forEach(function (key) {
          attributes[key] = extra[key];
        });
      }

      return attributes;
    }

    function getCartScopes() {
      var scopes = [];

      function add(node) {
        if (node && scopes.indexOf(node) === -1) scopes.push(node);
      }

      [
        "[data-cart-drwaer-body]",
        "[data-cart-wrapper]",
        "#ajax-cart-drawer",
        "#CartDrawer",
        "cart-drawer",
        ".cart-drawer",
        ".ajaxcart",
        ".mini-cart",
        "cart-items",
        "#main-cart-items",
        "form[action='/cart']",
        "form[action*='/cart']",
      ].forEach(function (selector) {
        document.querySelectorAll(selector).forEach(add);
      });

      return scopes;
    }

    function isWithinCartScope(element) {
      if (!element || !element.closest) return false;

      return !!element.closest(
        "[data-cart-drwaer-body], [data-cart-wrapper], #ajax-cart-drawer, #CartDrawer, cart-drawer, .cart-drawer, .ajaxcart, .mini-cart, cart-items, #main-cart-items, form[action='/cart'], form[action*='/cart']",
      );
    }

    function restoreMisplacedHides() {
      var legacyStyle = document.getElementById("pgy-tiered-gift-hide-style");
      if (legacyStyle) legacyStyle.remove();

      document
        .querySelectorAll(
          '[data-pgy-gift-hidden="true"], .pgy-tiered-gift-line--hidden',
        )
        .forEach(function (line) {
          if (isWithinCartScope(line)) return;

          delete line.dataset.pgyGiftHidden;
          line.classList.remove("pgy-tiered-gift-line--hidden");
          line.style.removeProperty("display");
          line.removeAttribute("hidden");
        });
    }

    function hideGiftLinesInDom() {
      if (isCartPage()) {
        document
          .querySelectorAll(
            '[data-pgy-gift-hidden="true"], .pgy-tiered-gift-line--hidden',
          )
          .forEach(function (line) {
            delete line.dataset.pgyGiftHidden;
            line.classList.remove("pgy-tiered-gift-line--hidden");
            line.style.removeProperty("display");
            line.removeAttribute("hidden");
          });
        return;
      }

      restoreMisplacedHides();

      var giftLineElements = getGiftLineElements();

      document
        .querySelectorAll(
          '[data-pgy-gift-hidden="true"], .pgy-tiered-gift-line--hidden',
        )
        .forEach(function (line) {
          if (!isWithinCartScope(line)) return;
          if (giftLineElements.indexOf(line) !== -1) return;

          delete line.dataset.pgyGiftHidden;
          line.classList.remove("pgy-tiered-gift-line--hidden");
          line.style.removeProperty("display");
          line.removeAttribute("hidden");
        });

      giftLineElements.forEach(function (line) {
        if (line.dataset.pgyGiftHidden === "true") return;
        line.dataset.pgyGiftHidden = "true";
        line.style.display = "none";
        line.setAttribute("hidden", "hidden");
        line.classList.add("pgy-tiered-gift-line--hidden");
      });
    }

    function getGiftLineElements() {
      var lines = [];
      var scopes = getCartScopes();
      var cartItems = (state.cart && state.cart.items) || [];
      var giftItems = cartItems.filter(isGiftLine);
      var giftKeys = giftItems
        .map(function (item) {
          return item.key;
        })
        .filter(Boolean);
      var labels = getGiftLabelKeys();

      if (!scopes.length) return lines;

      var lineSelector =
        "tr, cart-item, .cart-item, .cart__item, [data-cart-item], .line-item, .ajaxcart__row, .ajaxcart__product";

      function addLine(line) {
        if (!line || !isWithinCartScope(line)) return;
        if (line.closest && line.closest("[data-pgy-tiered-gift-banner]")) return;
        if (lines.indexOf(line) !== -1) return;
        lines.push(line);
      }

      function closestLine(node) {
        if (!node) return null;
        return (
          node.closest(lineSelector) ||
          node.closest("li") ||
          node.closest("[data-cart-item]") ||
          node
        );
      }

      scopes.forEach(function (scope) {
        giftKeys.forEach(function (key) {
          var escapedKey = cssEscape(key);
          [
            '[data-key="' + escapedKey + '"]',
            '[data-line-key="' + escapedKey + '"]',
            '[data-cart-item-key="' + escapedKey + '"]',
            '[data-cart-item-id="' + escapedKey + '"]',
          ].forEach(function (selector) {
            try {
              scope.querySelectorAll(selector).forEach(function (node) {
                addLine(closestLine(node));
              });
            } catch (_error) {}
          });
        });

        Array.prototype.forEach.call(
          scope.querySelectorAll(lineSelector + ", li"),
          function (line) {
            if (!isWithinCartScope(line)) return;
            var text = String(line.textContent || "")
              .replace(/\s+/g, " ")
              .toLowerCase();
            if (
              labels.some(function (label) {
                return (
                  text.indexOf(label + "(-") !== -1 ||
                  text.indexOf("◆ " + label) !== -1 ||
                  text.indexOf("◆" + label) !== -1 ||
                  text.indexOf(label + " (-") !== -1
                );
              })
            ) {
              addLine(line);
            }
          },
        );
      });

      return lines;
    }

    function removeGiftLinesFromDom() {
      getGiftLineElements().forEach(function (line) {
        if (line && line.parentElement) line.remove();
      });
    }

    function cssEscape(value) {
      if (window.CSS && typeof window.CSS.escape === "function") {
        return window.CSS.escape(String(value));
      }

      return String(value).replace(/["\\]/g, "\\$&");
    }

    function observeGiftLineDom() {
      new MutationObserver(function () {
        if (!getCartScopes().length) {
          restoreMisplacedHides();
          return;
        }

        hideGiftLinesInDom();
      }).observe(document.documentElement, { childList: true, subtree: true });
    }

    function updateHeaderCartCount(itemCount) {
      itemCount = Math.max(0, Number(itemCount || 0));

      if (typeof window.cartCountUpdate === "function") {
        try {
          window.cartCountUpdate(itemCount);
        } catch (error) {
          console.warn("[PGY tiered gift] cartCountUpdate failed.", error);
        }
      }

      document
        .querySelectorAll(
          "[data-header-cart-count], .cart-count, .cart-count-bubble, #cart-icon-bubble .cart-count-bubble span, .header-cart-count",
        )
        .forEach(function (el) {
          if (el.matches && el.matches(".cart-count-bubble") && !el.querySelector("span")) {
            el.textContent = itemCount > 0 ? String(itemCount > 99 ? "99+" : itemCount) : "";
            el.classList.toggle("hidden", itemCount <= 0);
            return;
          }

          if (el.children && el.children.length && el.querySelector("span")) {
            var span = el.querySelector("span");
            if (span) span.textContent = itemCount > 0 ? String(itemCount) : "";
          } else {
            el.textContent = itemCount > 0 && itemCount <= 99 ? String(itemCount) : itemCount > 99 ? "99+" : "";
          }

          el.classList.toggle("hidden", itemCount <= 0);
        });

      document
        .querySelectorAll(".cart.header-icons-link, [data-cart-count]")
        .forEach(function (el) {
          if (el.hasAttribute("data-cart-count")) {
            el.setAttribute("data-cart-count", String(itemCount));
          }
          el.classList.toggle("dot-icon", itemCount > 99);
        });
    }

    async function refreshCartPageUi(cart) {
      updateHeaderCartCount(cart && cart.item_count);
      removeGiftLinesFromDom();
      hideGiftLinesInDom();
      dispatchCartUpdated(cart);

      var sections = getCartSectionIds();
      var htmlMap = (cart && cart.sections) || null;

      try {
        if (!htmlMap || !Object.keys(htmlMap).length) {
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

          if (!response.ok) throw new Error("Failed to refresh cart sections");
          htmlMap = await response.json();
        }

        Object.keys(htmlMap).forEach(function (sectionId) {
          renderCartSection(sectionId, htmlMap[sectionId]);
        });
      } catch (error) {
        console.warn("[PGY tiered gift] Unable to refresh cart page UI.", error);
      }

      removeGiftLinesFromDom();
      hideGiftLinesInDom();
      updateHeaderCartCount(cart && cart.item_count);
      dispatchCartUpdated(cart);
      rebindThemeCart(document.querySelector("[data-cart-drwaer-body]") || document);
    }

    function getCartSectionIds() {
      var sections = [];

      function add(sectionId) {
        if (!sectionId || sections.indexOf(sectionId) !== -1) return;
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
          } catch (_error) {}
        });

      if (document.querySelector("[data-cart-drwaer-body], #ajax-cart-drawer")) {
        add("ajax-cart-drawer");
      }

      add("cart-drawer");
      add("cart-icon-bubble");

      if (isCartPage()) {
        add("main-cart-items");
        add("main-cart-footer");
      }

      return sections.slice(0, 5);
    }

    function renderCartSection(sectionId, html) {
      if (!html) return;

      var parsed = new DOMParser().parseFromString(html, "text/html");

      if (sectionId === "ajax-cart-drawer") {
        var body = document.querySelector("[data-cart-drwaer-body]");
        var nextWrapper =
          parsed.querySelector(".shopify-section") ||
          parsed.querySelector("[data-cart-drwaer-body]") ||
          parsed.body;

        if (body && nextWrapper) {
          body.innerHTML = nextWrapper.innerHTML;
          return;
        }

        replaceFirstMatching(
          ["[data-cart-drwaer-body]", "[data-cart-wrapper]", "#ajax-cart-drawer"],
          parsed,
        );
        return;
      }

      if (sectionId === "cart-drawer") {
        replaceFirstMatching(
          [
            "#CartDrawer .drawer__inner",
            ".cart-drawer .drawer__inner",
            "cart-drawer .drawer__inner",
            "#CartDrawer .cart-drawer__items",
            ".cart-drawer .cart-drawer__items",
          ],
          parsed,
        );
        return;
      }

      if (sectionId === "cart-icon-bubble") {
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
        return;
      }

      var current = document.getElementById("shopify-section-" + sectionId);
      var next = parsed.getElementById("shopify-section-" + sectionId);

      if (current && next) {
        current.innerHTML = next.innerHTML;
        return;
      }

      var directCurrent = document.getElementById(sectionId);
      var directNext = parsed.getElementById(sectionId);

      if (directCurrent && directNext) {
        directCurrent.innerHTML = directNext.innerHTML;
      }
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
        } catch (_error) {}
      });
    }

    function dispatchCartUpdated(cart) {
      try {
        var detail = { cart: cart || state.cart, source: "pgy-tiered-gift" };
        [
          "cart:updated",
          "cart:refresh",
          "theme:cart:change",
          "ajaxCart:updated",
          "cart-drawer:updated",
        ].forEach(function (eventName) {
          document.dispatchEvent(new CustomEvent(eventName, { detail: detail }));
        });
      } catch (_error) {}
    }

    function scheduleReturnCleanup(reason) {
      window.setTimeout(function () {
        runReturnCleanup(reason);
      }, 0);
    }

    async function runReturnCleanup(reason) {
      if (isCartPage()) {
        sessionStorage.setItem(CART_VISIT_KEY, "1");
        return;
      }

      log("return-cleanup", { reason: reason || "unknown" });
      state.ensuring = false;
      state.cleaning = false;
      state.refreshing = false;

      try {
        removeGiftLinesFromDom();
        await cleanupGiftLines({ immediate: true, forceUi: true });
        await refreshBanner();
      } catch (error) {
        console.warn("[PGY tiered gift] Return cleanup failed.", error);
        removeGiftLinesFromDom();
        hideGiftLinesInDom();
        refreshBanner();
      }
    }

    function isCartDrawerOpen() {
      var drawer = document.querySelector(
        "#ajax-cart-drawer, cart-drawer, #CartDrawer, .cart-drawer, .ajaxcart",
      );
      if (!drawer) {
        return (
          document.body.classList.contains("ajax-cart-open") ||
          document.documentElement.classList.contains("cart-open") ||
          document.documentElement.classList.contains("js-drawer-open")
        );
      }

      if (drawer.getAttribute("aria-hidden") === "false") return true;
      if (drawer.classList.contains("active")) return true;
      if (drawer.classList.contains("open")) return true;
      if (drawer.classList.contains("is-open")) return true;
      if (drawer.classList.contains("drawer--is-open")) return true;

      return (
        document.body.classList.contains("ajax-cart-open") ||
        document.documentElement.classList.contains("cart-open") ||
        document.documentElement.classList.contains("js-drawer-open")
      );
    }

    function bindReturnPageHandlers() {
      if (window.__pgyTieredGiftReturnBound) return;
      window.__pgyTieredGiftReturnBound = true;

      window.addEventListener("pageshow", function (event) {
        var fromCheckout = sessionStorage.getItem(STORAGE_KEY) === "1";
        var fromCart = sessionStorage.getItem(CART_VISIT_KEY) === "1";

        if (isCartPage()) {
          sessionStorage.setItem(CART_VISIT_KEY, "1");
          return;
        }

        if (!event.persisted && !fromCheckout && !fromCart) return;

        log("pageshow", {
          persisted: !!event.persisted,
          fromCheckout: fromCheckout,
          fromCart: fromCart,
        });
        scheduleReturnCleanup("pageshow");
      });

      document.addEventListener(
        "click",
        function (event) {
          if (isCartPage()) {
            sessionStorage.setItem(CART_VISIT_KEY, "1");
            return;
          }

          var target = event.target && event.target.closest && event.target.closest(
            [
              '[href="#ajax-cart-drawer"]',
              "[data-cart-drawer]",
              "[data-cart-drawer-close]",
              "[aria-controls='ajax-cart-drawer']",
              ".cart.header-icons-link",
              "#cart-icon-bubble",
              ".drawer__close",
              ".ajaxcart__close",
              ".js-drawer-close",
              ".cart-drawer__close",
              ".modal-close",
              ".drawer-overlay",
              ".js-drawer-overlay",
            ].join(", "),
          );

          if (!target) return;

          var closing =
            target.matches(
              "[data-cart-drawer-close], .drawer__close, .ajaxcart__close, .js-drawer-close, .cart-drawer__close, .modal-close, .drawer-overlay, .js-drawer-overlay",
            ) ||
            (isCartDrawerOpen() &&
              target.matches(
                '[href="#ajax-cart-drawer"], [data-cart-drawer], [aria-controls="ajax-cart-drawer"], .cart.header-icons-link, #cart-icon-bubble',
              ));

          if (closing) {
            sessionStorage.setItem(CART_VISIT_KEY, "1");
            scheduleReturnCleanup("cart-drawer-close");
            return;
          }

          sessionStorage.setItem(CART_VISIT_KEY, "1");
        },
        true,
      );
    }

    function isCartPage() {
      return window.location.pathname.replace(/\/+$/, "") === "/cart";
    }

    function getSubtotalWithoutGift(items) {
      return items.reduce(function (total, item) {
        if (isGiftLine(item)) return total;

        return (
          total +
          toNumber(
            item.final_line_price == null
              ? item.line_price
              : item.final_line_price,
          )
        );
      }, 0);
    }

    async function fetchJson(url, options) {
      var response = await fetch(url, options);
      var text = await response.text();
      var parsed;

      try {
        parsed = JSON.parse(text);
      } catch (error) {
        throw new Error(
          "Invalid JSON from " + url + " (" + response.status + ")",
        );
      }

      if (!response.ok) {
        var message =
          (parsed && (parsed.description || parsed.message)) ||
          "Request failed: " + response.status;
        var error = new Error(message);
        error.status = response.status;
        throw error;
      }

      return parsed;
    }

    async function fetchCart() {
      var cart = await fetchJson("/cart.js", {
        headers: { Accept: "application/json" },
        credentials: "same-origin",
      });
      state.cart = cart;
      debug.lastCart = cart;
      return cart;
    }

    async function refreshBanner() {
      if (state.refreshing) return;
      state.refreshing = true;

      try {
        await ensureTierVariants();
        var cart = await fetchCart();
        var subtotal = getSubtotalWithoutGift(cart.items || []);
        var active = getActiveTier(subtotal);
        var next = getNextTier(subtotal);
        var featured = active || next || null;
        var text = config.messages.empty;

        try {
          if (active) {
            text = formatMessage(config.messages.unlocked, {
              title: active.title,
              threshold: formatMoney(active.thresholdCents),
            });
          } else if (next) {
            text = formatMessage(config.messages.progress, {
              title: next.title,
              remaining: formatMoney(
                Math.max(0, next.thresholdCents - subtotal),
              ),
              threshold: formatMoney(next.thresholdCents),
            });
          } else if ((cart.item_count || 0) > 0) {
            text = formatMessage(config.messages.locked, {
              title: "",
            });
          }
        } catch (error) {
          console.warn("[PGY tiered gift] Banner text fallback.", error);
          text = active
            ? "Free gift unlocked: " + active.title
            : next
              ? "Spend more to unlock " + next.title
              : config.messages.empty;
        }

        renderBanners(text, !!active, featured);
        log("banner", {
          subtotal: subtotal,
          active: active && active.title,
          image: featured && featured.image,
        });
      } catch (error) {
        debug.lastError = error;
        console.warn("[PGY tiered gift] Unable to refresh banner.", error);
      } finally {
        state.refreshing = false;
      }
    }

    function scheduleBannerRefresh() {
      window.clearTimeout(state.timer);
      state.timer = window.setTimeout(refreshBanner, 300);
    }

    function getBannerMounts() {
      var mounts = [];

      function add(node) {
        if (node && mounts.indexOf(node) === -1) mounts.push(node);
      }

      document
        .querySelectorAll(".cart-drawer-content-header")
        .forEach(add);

      document.querySelectorAll(".cart-heading-wrapper").forEach(function (heading) {
        add(heading.parentElement || heading);
      });

      document.querySelectorAll("[data-cart-wrapper]").forEach(function (wrapper) {
        add(
          wrapper.querySelector(".cart-drawer-content-header") || wrapper,
        );
      });

      document
        .querySelectorAll("[data-cart-drwaer-body]")
        .forEach(function (body) {
          add(
            body.querySelector(".cart-drawer-content-header") ||
              body.querySelector(".cart-drawer-content") ||
              body,
          );
        });

      document.querySelectorAll("#ajax-cart-drawer").forEach(function (drawer) {
        add(
          drawer.querySelector(".cart-drawer-content-header") ||
            drawer.querySelector("[data-cart-wrapper]") ||
            drawer.querySelector(".cart-drawer-content"),
        );
      });

      document
        .querySelectorAll(
          "#CartDrawer .drawer__header, cart-drawer .drawer__header, .mini-cart__header, form[action='/cart'] .cart__header, #main-cart-items",
        )
        .forEach(add);

      return mounts;
    }

    function renderBanners(text, unlocked, featured) {
      state.bannerText = text || "";
      state.bannerUnlocked = !!unlocked;
      state.bannerFeatured = featured || null;

      var mounts = getBannerMounts();

      if (!mounts.length) {
        log("banner-no-mount");
        return;
      }

      mounts.forEach(function (mount) {
        var banner =
          mount.querySelector(":scope > [data-pgy-tiered-gift-banner]") ||
          mount.querySelector("[data-pgy-tiered-gift-banner]") ||
          createBanner();

        fillBanner(banner, text, unlocked, featured);

        if (mount.classList.contains("cart-drawer-content-header")) {
          if (banner.parentElement !== mount) mount.appendChild(banner);
        } else {
          var header = mount.querySelector(
            ".cart-heading-wrapper, .cart-drawer-content-header, .drawer__header, .cart-drawer__header, h3, h2",
          );

          if (header && header.parentElement) {
            if (banner.parentElement !== header.parentElement) {
              header.insertAdjacentElement("afterend", banner);
            }
          } else if (banner.parentElement !== mount) {
            mount.insertBefore(banner, mount.firstChild);
          }
        }
      });

      log("banner-rendered", {
        mounts: mounts.length,
        text: text,
        unlocked: !!unlocked,
        title: featured && featured.title,
      });
    }

    function fillBanner(banner, text, unlocked, featured) {
      var media = banner.querySelector("[data-pgy-tiered-gift-media]");
      var img = banner.querySelector("[data-pgy-tiered-gift-image]");
      var titleEl = banner.querySelector("[data-pgy-tiered-gift-title]");
      var messageEl = banner.querySelector("[data-pgy-tiered-gift-message]");

      if (!media || !img || !titleEl || !messageEl) {
        banner.innerHTML =
          '<div class="pgy-tiered-gift-banner__media" data-pgy-tiered-gift-media hidden>' +
          '<img class="pgy-tiered-gift-banner__image" data-pgy-tiered-gift-image alt="" width="56" height="56" loading="lazy" />' +
          "</div>" +
          '<div class="pgy-tiered-gift-banner__body">' +
          '<div class="pgy-tiered-gift-banner__title" data-pgy-tiered-gift-title></div>' +
          '<div class="pgy-tiered-gift-banner__message" data-pgy-tiered-gift-message></div>' +
          "</div>";
        media = banner.querySelector("[data-pgy-tiered-gift-media]");
        img = banner.querySelector("[data-pgy-tiered-gift-image]");
        titleEl = banner.querySelector("[data-pgy-tiered-gift-title]");
        messageEl = banner.querySelector("[data-pgy-tiered-gift-message]");
      }

      var title = (featured && featured.title) || "";
      var image = (featured && featured.image) || "";

      titleEl.textContent = title;
      titleEl.hidden = !title;
      messageEl.textContent = text || "";

      if (image) {
        img.src = image;
        img.alt = title || "Free gift";
        media.hidden = false;
      } else {
        img.removeAttribute("src");
        img.alt = "";
        media.hidden = true;
      }

      banner.classList.toggle("is-unlocked", !!unlocked);
      banner.classList.toggle("has-media", !!image);
      banner.hidden = !text;
    }

    function createBanner() {
      var banner = document.createElement("div");
      banner.className = "pgy-tiered-gift-banner col-12";
      banner.setAttribute("data-pgy-tiered-gift-banner", "true");
      banner.setAttribute("role", "status");
      fillBanner(banner, "", false, null);
      return banner;
    }

    function bindCartWatchers() {
      if (!window.__pgyTieredGiftFetchPatched) {
        window.__pgyTieredGiftFetchPatched = true;
        var originalFetch = window.fetch;

        window.fetch = async function () {
          var response = await originalFetch.apply(this, arguments);
          var url = String(
            (arguments[0] && (arguments[0].url || arguments[0])) || "",
          );

          if (
            !state.ensuring &&
            /\/cart\/(add|change|update|clear)(\.js)?(?:[?#].*)?$/.test(url)
          ) {
            scheduleBannerRefresh();
          }

          return response;
        };
      }

      [
        "cart:updated",
        "cart:refresh",
        "theme:cart:change",
        "ajaxCart:updated",
        "cart-drawer:updated",
      ].forEach(function (eventName) {
        document.addEventListener(eventName, scheduleBannerRefresh);
      });

      document.addEventListener(
        "click",
        function (event) {
          if (
            event.target &&
            event.target.closest &&
            event.target.closest(
              '[href="#ajax-cart-drawer"], [data-cart-drawer], .cart.header-icons-link, a[href="/cart"], #cart-icon-bubble, [aria-controls="ajax-cart-drawer"]',
            )
          ) {
            window.setTimeout(function () {
              if (state.bannerText) {
                renderBanners(
                  state.bannerText,
                  state.bannerUnlocked,
                  state.bannerFeatured,
                );
              } else {
                scheduleBannerRefresh();
              }
            }, 50);
            window.setTimeout(function () {
              if (state.bannerText) {
                renderBanners(
                  state.bannerText,
                  state.bannerUnlocked,
                  state.bannerFeatured,
                );
              }
            }, 400);
          }
        },
        true,
      );

      new MutationObserver(function () {
        if (!state.bannerText) return;

        var mounts = getBannerMounts();
        if (!mounts.length) return;

        var missing = mounts.some(function (mount) {
          return !mount.querySelector("[data-pgy-tiered-gift-banner]");
        });

        if (missing) {
          renderBanners(
            state.bannerText,
            state.bannerUnlocked,
            state.bannerFeatured,
          );
        }
      }).observe(document.documentElement, { childList: true, subtree: true });
    }

    function getCheckoutLabel(element) {
      if (!element) return "";

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

    var BUY_NOW_SELECTOR =
      '[data-buy-now], [data-shop-now], [data-deal-grid-shop-link], [data-action="buy-now"], [data-action="shop-now"], .buy-now, .buy_now, .shop-now, .shop_now, .deal-product-grid__shop-btn, .product-buy-now, .product-shop-now, button[name="buy"], .shopify-payment-button, [data-shopify="payment-button"], shopify-accelerated-checkout';

    function parseCartPermalink(href) {
      if (!href) return null;

      var match = String(href).match(/\/cart\/(\d+)(?::(\d+))?/i);
      if (!match) return null;

      return {
        variantId: toNumber(match[1]),
        quantity: toNumber(match[2]) || 1,
      };
    }

    function findBuyNowButton(element) {
      var candidate = element.closest(BUY_NOW_SELECTOR);
      if (candidate) return candidate;

      var button = element.closest("button, a, input[type='submit']");
      if (!button) return null;

      if (parseCartPermalink(button.getAttribute("href") || button.href)) {
        return button;
      }

      var label = getCheckoutLabel(button);

      if (
        label.indexOf("buy it now") !== -1 ||
        label.indexOf("shop now") !== -1 ||
        label.indexOf("buy now") !== -1 ||
        label.indexOf("立即购买") !== -1 ||
        label.indexOf("马上购买") !== -1
      ) {
        return button;
      }

      return null;
    }

    function isBuyNowTrigger(trigger) {
      if (!trigger) return false;

      if (trigger.matches && trigger.matches(BUY_NOW_SELECTOR)) return true;
      if (parseCartPermalink(trigger.getAttribute && trigger.getAttribute("href") || trigger.href)) {
        return true;
      }

      var label = getCheckoutLabel(trigger);

      return (
        label.indexOf("buy it now") !== -1 ||
        label.indexOf("shop now") !== -1 ||
        label.indexOf("buy now") !== -1 ||
        label.indexOf("立即购买") !== -1 ||
        label.indexOf("马上购买") !== -1
      );
    }

    function getBuyNowProductForm(trigger) {
      if (!trigger) return null;

      if (trigger.form && trigger.form.matches('form[action*="/cart/add"]')) {
        return trigger.form;
      }

      if (trigger.closest) {
        var closestForm = trigger.closest('form[action*="/cart/add"]');
        if (closestForm) return closestForm;

        var formId = trigger.getAttribute && trigger.getAttribute("form");
        if (formId) {
          var linkedForm = document.getElementById(formId);
          if (linkedForm && linkedForm.matches('form[action*="/cart/add"]')) {
            return linkedForm;
          }
        }

        var productScope = trigger.closest(
          "product-info, product-form, .product, .product-form, [data-product], [data-product-form]",
        );
        if (productScope) {
          var scopedForm = productScope.querySelector('form[action*="/cart/add"]');
          if (scopedForm) return scopedForm;
        }
      }

      return null;
    }

    async function addBuyNowProductToCart(trigger) {
      var permalink = parseCartPermalink(
        (trigger.getAttribute && trigger.getAttribute("href")) || trigger.href,
      );

      if (permalink && permalink.variantId) {
        log("buy-now-add-product", {
          source: "cart-permalink",
          variantId: permalink.variantId,
          quantity: permalink.quantity,
        });

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

      var form = getBuyNowProductForm(trigger);
      if (!form) {
        throw new Error("Unable to find the Buy Now product form.");
      }

      var formData = new FormData(form);
      var variantId = toNumber(formData.get("id"));

      if (!variantId) {
        throw new Error("Unable to read the selected Buy Now variant.");
      }

      formData.delete("sections");
      formData.delete("sections_url");

      log("buy-now-add-product", {
        source: "product-form",
        variantId: variantId,
        quantity: toNumber(formData.get("quantity")) || 1,
      });

      await fetchJson("/cart/add.js", {
        method: "POST",
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        body: formData,
      });
    }

    function isCheckoutTrigger(element) {
      if (!element || !element.closest) return null;

      var inCart = isWithinCartScope(element) || isWithinCartScope(element.closest("form"));

      var trigger =
        element.closest('[name="checkout"]') ||
        element.closest(".cart__checkout-button") ||
        element.closest(".cart-drawer__checkout-button") ||
        element.closest(".ajaxcart__checkout") ||
        element.closest("#checkout") ||
        element.closest("[data-checkout]") ||
        element.closest(".checkout-button") ||
        element.closest('a[href="/checkout"]') ||
        element.closest('a[href^="/checkout?"]') ||
        findBuyNowButton(element);

      if (trigger) return trigger;

      if (!inCart) return null;

      var button = element.closest("button, a, input[type='submit']");
      if (!button) return null;

      var label = getCheckoutLabel(button);

      if (
        /check\s*out|去结算|结账|立即结账/.test(label) &&
        label.indexOf("view cart") === -1 &&
        label.indexOf("查看购物车") === -1
      ) {
        return button;
      }

      return null;
    }

    function getCheckoutUrl(trigger) {
      if (trigger && trigger.tagName === "A" && trigger.href) {
        if (parseCartPermalink(trigger.href)) return "/checkout";
        if (/\/checkout/.test(trigger.href)) return trigger.href;
      }

      if (trigger && trigger.form && trigger.form.action) {
        var action = trigger.form.action;

        if (/\/checkout/.test(action)) return action;
      }

      return "/checkout";
    }

    function bindCheckoutInterceptors() {
      function onCheckoutAttempt(event, trigger) {
        event.preventDefault();
        event.stopPropagation();
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();
        if (state.ensuring) return;
        handleCheckoutIntent(trigger);
      }

      document.addEventListener(
        "mousedown",
        function (event) {
          var trigger = isCheckoutTrigger(event.target);
          if (!trigger) return;
          onCheckoutAttempt(event, trigger);
        },
        true,
      );

      document.addEventListener(
        "click",
        function (event) {
          var trigger = isCheckoutTrigger(event.target);
          if (!trigger) return;
          onCheckoutAttempt(event, trigger);
        },
        true,
      );

      document.addEventListener(
        "submit",
        function (event) {
          var form = event.target;
          if (!form || !form.matches) return;

          var checkoutSubmit =
            (event.submitter &&
              event.submitter.getAttribute &&
              event.submitter.getAttribute("name") === "checkout") ||
            form.querySelector('[name="checkout"]');

          if (!checkoutSubmit && !isWithinCartScope(form)) return;
          if (
            !checkoutSubmit &&
            !/check\s*out|去结算|结账/.test(getCheckoutLabel(event.submitter))
          ) {
            return;
          }

          onCheckoutAttempt(event, checkoutSubmit || form);
        },
        true,
      );
    }

    function setTriggerLoading(trigger, loading) {
      if (!trigger) return;

      if (loading) {
        trigger.classList.add("pgy-tiered-gift-loading");
        trigger.setAttribute("aria-busy", "true");
        trigger.setAttribute("aria-disabled", "true");

        if ("disabled" in trigger) {
          trigger.dataset.pgyWasDisabled = trigger.disabled ? "1" : "0";
          trigger.disabled = true;
        }

        if (trigger.tagName === "A") {
          trigger.dataset.pgyPrevTabindex = trigger.getAttribute("tabindex") || "";
          trigger.setAttribute("tabindex", "-1");
        }

        return;
      }

      trigger.classList.remove("pgy-tiered-gift-loading");
      trigger.removeAttribute("aria-busy");
      trigger.removeAttribute("aria-disabled");

      if ("disabled" in trigger) {
        trigger.disabled = trigger.dataset.pgyWasDisabled === "1";
        delete trigger.dataset.pgyWasDisabled;
      }

      if (trigger.tagName === "A") {
        if (trigger.dataset.pgyPrevTabindex) {
          trigger.setAttribute("tabindex", trigger.dataset.pgyPrevTabindex);
        } else {
          trigger.removeAttribute("tabindex");
        }
        delete trigger.dataset.pgyPrevTabindex;
      }
    }

    async function handleCheckoutIntent(trigger) {
      if (state.ensuring) return;
      state.ensuring = true;

      var checkoutUrl = getCheckoutUrl(trigger);
      var buyNow = isBuyNowTrigger(trigger);
      var navigated = false;

      setTriggerLoading(trigger, true);

      try {
        if (buyNow) {
          await addBuyNowProductToCart(trigger);
        }
        await ensureGiftInCart();
        sessionStorage.setItem(STORAGE_KEY, "1");
        log("checkout-ready", { url: checkoutUrl, buyNow: buyNow });
        navigated = true;
        window.location.assign(checkoutUrl);
      } catch (error) {
        debug.lastError = error;
        console.warn("[PGY tiered gift] Unable to prepare checkout gift.", error);
        sessionStorage.setItem(STORAGE_KEY, "1");
        navigated = true;
        window.location.assign(checkoutUrl);
      } finally {
        state.ensuring = false;
        if (!navigated) setTriggerLoading(trigger, false);
      }
    }

    async function ensureGiftInCart() {
      await ensureTierVariants();

      var cart = await fetchCart();
      var subtotal = getSubtotalWithoutGift(cart.items || []);
      var active = getActiveTier(subtotal);
      var giftLines = (cart.items || []).filter(isGiftLine);
      var updates = {};

      giftLines.forEach(function (item) {
        if (!active || Number(item.variant_id) !== active.variantId) {
          updates[item.key] = 0;
        } else if (item.quantity !== 1) {
          updates[item.key] = 1;
        }
      });

      if (Object.keys(updates).length) {
        await fetchJson("/cart/update.js", {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          credentials: "same-origin",
          body: JSON.stringify({ updates: updates }),
        });
        cart = await fetchCart();
      }

      if (!active || !active.variantId) {
        log("checkout-no-tier", { subtotal: subtotal });
        return;
      }

      var hasGift = (cart.items || []).some(function (item) {
        return isGiftLine(item) && Number(item.variant_id) === active.variantId;
      });

      var needsDiscountFlags = (cart.items || []).some(function (item) {
        if (!isGiftLine(item) || Number(item.variant_id) !== active.variantId) {
          return false;
        }

        var props = item.properties || {};
        return !hasGiftFlag(props._pgy_free_gift);
      });

      if (hasGift && needsDiscountFlags) {
        var restamp = {};
        (cart.items || []).forEach(function (item) {
          if (isGiftLine(item) && Number(item.variant_id) === active.variantId) {
            restamp[item.key] = 0;
          }
        });

        if (Object.keys(restamp).length) {
          await fetchJson("/cart/update.js", {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            credentials: "same-origin",
            body: JSON.stringify({ updates: restamp }),
          });
          cart = await fetchCart();
          hasGift = false;
        }
      }

      if (!hasGift) {
        var properties = {};
        properties[config.propertyName] = config.propertyValue;
        properties._pgy_free_gift = config.propertyValue;
        properties._pgy_tiered_gift = config.propertyValue;
        properties._pgy_tiered_gift_variant_id = String(active.variantId);

        log("checkout-add-gift", {
          variantId: active.variantId,
          title: active.title,
          sku: active.sku || "",
        });

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
                id: active.variantId,
                quantity: 1,
                properties: properties,
              },
            ],
            attributes: giftAttributePayload({
              _pgy_tiered_gift_variant_id: String(active.variantId),
            }),
          }),
        });

        cart = await fetchCart();
      }

      var verified = (cart.items || []).some(function (item) {
        return isGiftLine(item) && Number(item.variant_id) === active.variantId;
      });

      if (!verified) {
        throw new Error(
          "Gift variant " +
            active.variantId +
            " was not added. Check variant ID / product availability.",
        );
      }

      log("gift-in-cart", {
        variantId: active.variantId,
        title: active.title,
        itemCount: cart.item_count,
      });

      await fetchJson("/cart/update.js", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({
          attributes: giftAttributePayload({
            _pgy_tiered_gift_variant_id: String(active.variantId),
          }),
        }),
      });
    }

    async function cleanupGiftLines(options) {
      options = options || {};
      if (state.cleaning || state.ensuring) return;
      state.cleaning = true;

      try {
        await ensureTierVariants();
        removeGiftLinesFromDom();
        hideGiftLinesInDom();

        var cart = await fetchCart();
        var giftLines = (cart.items || []).filter(isGiftLine);
        var giftQty = giftLines.reduce(function (sum, item) {
          return sum + Number(item.quantity || 0);
        }, 0);

        if (!giftLines.length) {
          var shouldRefreshUi =
            options.forceUi ||
            sessionStorage.getItem(STORAGE_KEY) === "1" ||
            sessionStorage.getItem(CART_VISIT_KEY) === "1";

          sessionStorage.removeItem(STORAGE_KEY);
          sessionStorage.removeItem(CART_VISIT_KEY);
          updateHeaderCartCount(cart.item_count);
          removeGiftLinesFromDom();
          hideGiftLinesInDom();

          if (shouldRefreshUi) {
            await refreshCartPageUi(cart);
          }

          return cart;
        }

        log("cleanup-gift-lines", {
          count: giftLines.length,
          qty: giftQty,
          immediate: !!options.immediate,
        });

        updateHeaderCartCount(Math.max(0, Number(cart.item_count || 0) - giftQty));
        removeGiftLinesFromDom();
        hideGiftLinesInDom();

        var updates = {};
        giftLines.forEach(function (item) {
          updates[item.key] = 0;
        });

        var updatedCart = await fetchJson("/cart/update.js", {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          credentials: "same-origin",
          body: JSON.stringify({
            updates: updates,
            attributes: {
              _pgy_tiered_gift: "",
              _pgy_tiered_gift_variant_id: "",
              _pgy_free_gift: "",
              _pgy_free_gift_variant_id: "",
              _pgy_gift_discount_label: "",
            },
            sections: getCartSectionIds(),
            sections_url: window.location.pathname,
          }),
        });

        sessionStorage.removeItem(STORAGE_KEY);
        sessionStorage.removeItem(CART_VISIT_KEY);
        state.cart = updatedCart;
        debug.lastCart = updatedCart;

        await refreshCartPageUi(updatedCart);
        return updatedCart;
      } catch (error) {
        debug.lastError = error;
        console.warn("[PGY tiered gift] Unable to cleanup gift lines.", error);
        removeGiftLinesFromDom();
        hideGiftLinesInDom();
        throw error;
      } finally {
        state.cleaning = false;
      }
    }

    function formatMessage(template, values) {
      return String(template || "").replace(
        /\{\{\s*(\w+)\s*\}\}|\[\s*(\w+)\s*\]/g,
        function (match, a, b) {
          var key = a || b;
          return values[key] != null ? values[key] : "";
        },
      );
    }

    function formatMoney(cents) {
      cents = toNumber(cents);
      var currency =
        (window.Shopify &&
          window.Shopify.currency &&
          window.Shopify.currency.active) ||
        "USD";

      try {
        return new Intl.NumberFormat(undefined, {
          style: "currency",
          currency: currency,
        }).format(cents / 100);
      } catch (error) {
        return "$" + (cents / 100).toFixed(2);
      }
    }

    function toNumber(value) {
      var number = Number(value);
      return Number.isFinite(number) ? number : 0;
    }
  }
})();
