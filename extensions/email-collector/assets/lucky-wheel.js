(function () {
  var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var state = {
    claim: null,
    statusStarted: false,
  };

  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn);
    } else {
      fn();
    }
  }

  function storageKey() {
    var shop = (window.Shopify && window.Shopify.shop) || "shop";
    return "pgy-lucky-wheel:" + shop;
  }

  function readStoredClaim() {
    try {
      var raw = window.localStorage.getItem(storageKey());
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || !data.couponCode) return null;
      return data;
    } catch (error) {
      return null;
    }
  }

  function writeStoredClaim(claim) {
    try {
      window.localStorage.setItem(
        storageKey(),
        JSON.stringify({
          email: claim.email || "",
          couponCode: claim.couponCode,
          percentOff: claim.percentOff,
          label: claim.label,
          sectorIndex: Number(claim.sectorIndex) || 0,
        }),
      );
    } catch (error) {
      /* ignore private mode */
    }
  }

  function clearStoredClaim() {
    try {
      window.localStorage.removeItem(storageKey());
    } catch (error) {
      /* ignore */
    }
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

  function readJson(response) {
    var contentType = response.headers.get("content-type") || "";
    if (contentType.indexOf("application/json") === -1) return Promise.resolve(null);
    return response.json().catch(function () {
      return null;
    });
  }

  function showMessage(el, text, isError) {
    if (!el) return;
    el.textContent = text || "";
    el.hidden = !text;
    el.classList.toggle("pgy-lw__message--success", !isError && Boolean(text));
  }

  function stringsFrom(root) {
    return {
      invalid: root.dataset.msgInvalid || "Please enter a valid email address.",
      phone: root.dataset.msgPhone || "Enter a valid phone number or leave it blank.",
      agree: root.dataset.msgAgree || "Please agree to receive emails to spin.",
      error: root.dataset.msgError || "Something went wrong. Please try again.",
      preview:
        root.dataset.msgPreview ||
        "Please test on the live storefront. Theme editor preview does not support App Proxy.",
      copied: root.dataset.msgCopied || "Copied!",
      copyFail: root.dataset.msgCopyFail || "Copy failed. Please copy the code manually.",
      spin: root.dataset.spinLabel || "SPIN TO WIN",
      spinning: root.dataset.spinningLabel || "SPINNING...",
    };
  }

  function normalizeDeg(deg) {
    return ((deg % 360) + 360) % 360;
  }

  function spinAngle(current, sectorIndex) {
    var target = normalizeDeg(-sectorIndex * 60);
    var minAngle = current - 360 * 5;
    var extra = normalizeDeg(normalizeDeg(minAngle) - target);
    return minAngle - extra;
  }

  function currentAngle(rotor) {
    var value = Number(rotor.dataset.angle);
    return Number.isFinite(value) ? value : 0;
  }

  function placeWheel(rotor, sectorIndex, animate) {
    var next = animate ? spinAngle(currentAngle(rotor), sectorIndex) : -sectorIndex * 60;
    if (animate) {
      rotor.style.transition = "transform 4.6s cubic-bezier(0.12, 0.72, 0.08, 1)";
      if (rotor.getBoundingClientRect) rotor.getBoundingClientRect();
    } else {
      rotor.style.transition = "none";
    }
    rotor.dataset.angle = String(next);
    rotor.style.transform = "rotate(" + next + "deg)";
    return next;
  }

  function animateWheel(rotor, sectorIndex) {
    var reduce =
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !rotor) {
      if (rotor) placeWheel(rotor, sectorIndex, false);
      return Promise.resolve();
    }

    return new Promise(function (resolve) {
      var settled = false;
      function done() {
        if (settled) return;
        settled = true;
        rotor.removeEventListener("transitionend", onEnd);
        resolve();
      }
      function onEnd(event) {
        if (event.target !== rotor || event.propertyName !== "transform") return;
        done();
      }
      rotor.addEventListener("transitionend", onEnd);
      placeWheel(rotor, sectorIndex, true);
      window.setTimeout(done, 5200);
    });
  }

  function fillResult(root, claim) {
    var amount = root.querySelector("[data-pgy-lw-amount]");
    var code = root.querySelector("[data-pgy-lw-code]");
    var note = root.querySelector("[data-pgy-lw-note]");
    if (amount) {
      amount.textContent =
        claim.label || "Extra " + (claim.percentOff || "") + "% OFF";
    }
    if (code) code.textContent = claim.couponCode || "";
    if (note && root.dataset.footnote) note.textContent = root.dataset.footnote;
  }

  function updateRoot(root) {
    var claim = state.claim;
    var dot = root.querySelector("[data-pgy-lw-dot]");
    if (dot) {
      dot.hidden = !(root.dataset.showDot === "true" && claim && claim.couponCode);
    }
    if (!claim || !claim.couponCode) return;
    fillResult(root, claim);
    if (root.dataset.spinning === "true") return;
    var rotor = root.querySelector("[data-pgy-lw-rotor]");
    if (rotor && root.dataset.wheelCode !== claim.couponCode) {
      placeWheel(rotor, Number(claim.sectorIndex) || 0, false);
      root.dataset.wheelCode = claim.couponCode;
    }
  }

  function setClaim(claim) {
    state.claim = claim && claim.couponCode ? claim : null;
    if (state.claim) writeStoredClaim(state.claim);
    document.querySelectorAll("[data-pgy-lw]").forEach(updateRoot);
  }

  function clearClaim() {
    state.claim = null;
    clearStoredClaim();
    document.querySelectorAll("[data-pgy-lw]").forEach(function (root) {
      delete root.dataset.wheelCode;
      updateRoot(root);
    });
  }

  function anyOverlayOpen() {
    return Boolean(document.querySelector("[data-pgy-lw-overlay]:not([hidden])"));
  }

  function closeModal(root) {
    var overlay = root.querySelector("[data-pgy-lw-overlay]");
    if (overlay) overlay.hidden = true;
    if (!anyOverlayOpen()) document.documentElement.classList.remove("pgy-lw-lock");
  }

  function showResultPanel(root, claim, fresh) {
    fillResult(root, claim);
    var title = root.querySelector("[data-pgy-lw-result-title]");
    if (title) {
      title.textContent = fresh
        ? root.dataset.wonTitle || "You won"
        : root.dataset.savedTitle || "Your coupon";
    }
    var form = root.querySelector('[data-pgy-lw-panel="form"]');
    var result = root.querySelector('[data-pgy-lw-panel="result"]');
    if (form) form.hidden = true;
    if (result) result.hidden = false;
  }

  function showFormPanel(root) {
    var form = root.querySelector('[data-pgy-lw-panel="form"]');
    var result = root.querySelector('[data-pgy-lw-panel="result"]');
    if (form) form.hidden = false;
    if (result) result.hidden = true;
    showMessage(root.querySelector("[data-pgy-lw-message]"), "", false);
  }

  function openModal(root, mode) {
    var overlay = root.querySelector("[data-pgy-lw-overlay]");
    if (!overlay) return;
    var claimed = Boolean(state.claim && state.claim.couponCode);
    var asResult = mode === "result" || (mode !== "form" && claimed) || !root.querySelector("[data-pgy-lw-form]");
    if (mode === "form" && !claimed) asResult = false;
    if (asResult && claimed) showResultPanel(root, state.claim, false);
    else showFormPanel(root);
    overlay.hidden = false;
    document.documentElement.classList.add("pgy-lw-lock");
    var focusTarget = asResult
      ? root.querySelector("[data-pgy-lw-copy]")
      : root.querySelector("[data-pgy-lw-email]");
    if (focusTarget) window.setTimeout(function () { focusTarget.focus(); }, 30);
  }

  function copyCode(root, code) {
    var message = root.querySelector("[data-pgy-lw-copy-message]");
    var strings = stringsFrom(root);
    function done(ok) {
      showMessage(message, ok ? strings.copied : strings.copyFail, !ok);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(function () { done(true); }).catch(function () {
        done(fallbackCopy(code));
      });
      return;
    }
    done(fallbackCopy(code));
  }

  function fallbackCopy(code) {
    var input = document.createElement("textarea");
    input.value = code;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.left = "-9999px";
    document.body.appendChild(input);
    input.select();
    var ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (error) {
      ok = false;
    }
    document.body.removeChild(input);
    return ok;
  }

  function phoneLooksValid(value) {
    var trimmed = String(value || "").trim();
    if (!trimmed) return true;
    var digits = trimmed.replace(/\D/g, "");
    return digits.length >= 7 && digits.length <= 15;
  }

  function applyPrizeLabels(root, prizes) {
    if (!prizes || prizes.length < 3) return;
    prizes.forEach(function (prize, index) {
      root.querySelectorAll('[data-pgy-lw-slice="' + index + '"]').forEach(function (el) {
        var label = prize.label || el.getAttribute("data-pgy-lw-label") || el.textContent;
        var offIndex = label.lastIndexOf(" OFF");
        if (offIndex > 0) {
          el.innerHTML = "";
          el.appendChild(document.createTextNode(label.slice(0, offIndex)));
          el.appendChild(document.createElement("br"));
          el.appendChild(document.createTextNode("OFF"));
        } else {
          el.textContent = label;
        }
      });
    });
  }

  function fetchConfig(root) {
    if (root.dataset.designMode === "true") return;
    if (root.dataset.configLoaded === "true") return;
    root.dataset.configLoaded = "true";
    var proxyUrl = root.dataset.proxyUrl || "/apps/pgy-tech/lucky-wheel";
    window.fetch(withQuery(proxyUrl, {}), { headers: { Accept: "application/json" } })
      .then(readJson)
      .then(function (data) {
        if (data && data.ok && data.prizes) applyPrizeLabels(root, data.prizes);
      })
      .catch(function () {});
  }

  function bindRoot(root) {
    if (root.dataset.bound === "true") return;
    root.dataset.bound = "true";
    var strings = stringsFrom(root);

    root.querySelectorAll("[data-pgy-lw-open]").forEach(function (button) {
      button.addEventListener("click", function () {
        openModal(root, state.claim && state.claim.couponCode ? "result" : "form");
      });
    });

    root.querySelectorAll("[data-pgy-lw-dot]").forEach(function (button) {
      button.addEventListener("click", function () {
        openModal(root, "result");
      });
    });

    root.querySelectorAll("[data-pgy-lw-close]").forEach(function (button) {
      button.addEventListener("click", function () {
        closeModal(root);
      });
    });

    var overlay = root.querySelector("[data-pgy-lw-overlay]");
    if (overlay) {
      overlay.addEventListener("click", function (event) {
        if (event.target === overlay) closeModal(root);
      });
    }

    var copyButton = root.querySelector("[data-pgy-lw-copy]");
    if (copyButton) {
      copyButton.addEventListener("click", function () {
        var codeEl = root.querySelector("[data-pgy-lw-code]");
        var code = codeEl ? codeEl.textContent.trim() : "";
        if (code) copyCode(root, code);
      });
    }

    var form = root.querySelector("[data-pgy-lw-form]");
    if (form) {
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        submitSpin(root, strings);
      });
    }

    fetchConfig(root);
  }

  function submitSpin(root, strings) {
    if (root.dataset.spinning === "true") return;
    var message = root.querySelector("[data-pgy-lw-message]");
    var emailInput = root.querySelector("[data-pgy-lw-email]");
    var phoneInput = root.querySelector("[data-pgy-lw-phone]");
    var agreeInput = root.querySelector("[data-pgy-lw-agree]");
    var submit = root.querySelector("[data-pgy-lw-submit]");
    var email = emailInput ? emailInput.value.trim() : "";
    var phone = phoneInput ? phoneInput.value.trim() : "";

    if (!EMAIL_PATTERN.test(email)) {
      showMessage(message, strings.invalid, true);
      if (emailInput) emailInput.focus();
      return;
    }
    if (!phoneLooksValid(phone)) {
      showMessage(message, strings.phone, true);
      if (phoneInput) phoneInput.focus();
      return;
    }
    if (agreeInput && !agreeInput.checked) {
      showMessage(message, strings.agree, true);
      return;
    }
    if (root.dataset.designMode === "true") {
      showMessage(message, strings.preview, true);
      return;
    }

    root.dataset.spinning = "true";
    if (submit) {
      submit.disabled = true;
      submit.textContent = strings.spinning;
    }
    showMessage(message, "", false);

    var proxyUrl = root.dataset.proxyUrl || "/apps/pgy-tech/lucky-wheel";
    window.fetch(proxyUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: email,
        phone: phone,
        agreed: true,
      }),
    })
      .then(function (response) {
        return readJson(response).then(function (data) {
          return { response: response, data: data };
        });
      })
      .then(function (result) {
        var data = result.data;
        if (!data || !data.ok || !data.claim) {
          throw new Error((data && data.error) || strings.error);
        }
        var rotor = root.querySelector("[data-pgy-lw-rotor]");
        var overlay = root.querySelector("[data-pgy-lw-overlay]");
        if (data.alreadyClaimed) {
          root.dataset.spinning = "false";
          setClaim(data.claim);
          if (overlay && !overlay.hidden) showResultPanel(root, data.claim, false);
          return null;
        }
        return animateWheel(rotor, Number(data.claim.sectorIndex) || 0).then(function () {
          root.dataset.spinning = "false";
          root.dataset.wheelCode = data.claim.couponCode;
          setClaim(data.claim);
          if (overlay && !overlay.hidden) showResultPanel(root, data.claim, true);
        });
      })
      .catch(function (error) {
        root.dataset.spinning = "false";
        showMessage(message, error && error.message ? error.message : strings.error, true);
      })
      .then(function () {
        if (submit) {
          submit.disabled = false;
          submit.textContent = strings.spin;
        }
      });
  }

  function assignDots(roots) {
    var hasEmbed = false;
    roots.forEach(function (root) {
      if (root.dataset.mode === "embed") hasEmbed = true;
    });
    var dotAssigned = false;
    roots.forEach(function (root) {
      var show = false;
      if (root.dataset.mode === "embed") show = true;
      else if (!hasEmbed && !dotAssigned) {
        show = true;
        dotAssigned = true;
      }
      root.dataset.showDot = show ? "true" : "false";
    });
  }

  function ensureStatus(roots) {
    if (state.statusStarted) return;
    state.statusStarted = true;

    var customerEmail = "";
    var proxyUrl = "/apps/pgy-tech/lucky-wheel";
    var designMode = false;
    roots.forEach(function (root) {
      if (!customerEmail && root.dataset.customerEmail) customerEmail = root.dataset.customerEmail.trim();
      if (root.dataset.proxyUrl) proxyUrl = root.dataset.proxyUrl;
      if (root.dataset.designMode === "true") designMode = true;
    });

    var stored = readStoredClaim();
    var initial = stored;
    if (customerEmail) {
      initial =
        stored &&
        stored.email &&
        stored.email.toLowerCase() === customerEmail.toLowerCase()
          ? stored
          : null;
    }
    if (initial) setClaim(initial);
    if (designMode) return;

    var emailForStatus = customerEmail || (stored && stored.email) || "";
    if (!emailForStatus) return;

    window.fetch(withQuery(proxyUrl, { action: "status", email: emailForStatus }), {
      headers: { Accept: "application/json" },
    })
      .then(readJson)
      .then(function (data) {
        if (!data || !data.ok) return;
        if (data.claimed && data.claim) {
          setClaim(data.claim);
          return;
        }
        var asked = emailForStatus.toLowerCase();
        var storedEmail = stored && stored.email ? stored.email.toLowerCase() : "";
        if (!storedEmail || storedEmail === asked) clearClaim();
      })
      .catch(function () {});
  }

  function boot() {
    var roots = Array.prototype.slice.call(document.querySelectorAll("[data-pgy-lw]"));
    if (!roots.length) return;
    assignDots(roots);
    roots.forEach(bindRoot);
    roots.forEach(updateRoot);
    ensureStatus(roots);
  }

  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;
    document.querySelectorAll("[data-pgy-lw]").forEach(function (root) {
      var overlay = root.querySelector("[data-pgy-lw-overlay]");
      if (overlay && !overlay.hidden) closeModal(root);
    });
  });

  ready(boot);
})();
