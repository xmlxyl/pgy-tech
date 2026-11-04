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

  function rewardPercentNumber(claim) {
    return Math.round(Number(claim && claim.percentOff));
  }

  function fixedCouponCode(claim) {
    var percent = rewardPercentNumber(claim);
    if (percent === 2) return "BFEXTRA2";
    if (percent === 3) return "BFEXTRA3";
    if (percent === 5) return "BFEXTRA5";
    return (claim && claim.couponCode) || "";
  }

  function sectorForReward(claim) {
    var percent = rewardPercentNumber(claim);
    if (percent === 2) return 1;
    if (percent === 3) return 0;
    if (percent === 5) return 2;
    return 0;
  }

  function readStoredClaim() {
    try {
      var raw = window.localStorage.getItem(storageKey());
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || !data.couponCode) return null;
      data.couponCode = fixedCouponCode(data);
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
          couponCode: fixedCouponCode(claim),
          percentOff: claim.percentOff,
          label: claim.label,
          sectorIndex: sectorForReward(claim),
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

  function prizeAngle(sectorIndex) {
    return -Number(sectorIndex || 0) * 60;
  }

  function placeWheel(rotor, sectorIndex, animate) {
    var landed = prizeAngle(sectorIndex);
    var next = landed;
    if (animate) {
      var current = currentAngle(rotor);
      next = current - 360 * 5;
      var extra = normalizeDeg(normalizeDeg(next) - normalizeDeg(landed));
      next -= extra;
      rotor.style.transition = "transform 4.6s cubic-bezier(0.12, 0.72, 0.08, 1)";
      if (rotor.getBoundingClientRect) rotor.getBoundingClientRect();
    } else {
      rotor.style.transition = "none";
    }
    rotor.dataset.angle = String(next);
    rotor.dataset.sector = String(sectorIndex);
    rotor.style.transform = "rotate(" + next + "deg)";
    return next;
  }

  function readRotation(rotor) {
    var transform = window.getComputedStyle(rotor).transform;
    if (!transform || transform === "none") return currentAngle(rotor);
    var values = transform.match(/matrix\(([^)]+)\)/);
    if (!values) return currentAngle(rotor);
    var parts = values[1].split(",");
    var radians = Math.atan2(parseFloat(parts[1]), parseFloat(parts[0]));
    if (!Number.isFinite(radians)) return currentAngle(rotor);
    return (radians * 180) / Math.PI;
  }

  function startIdleSpin(rotor) {
    if (!rotor) return;
    rotor.classList.add("is-spinning");
  }

  function stopIdleSpin(rotor) {
    if (!rotor) return;
    var angle = readRotation(rotor);
    rotor.classList.remove("is-spinning");
    rotor.style.animation = "none";
    rotor.style.transition = "none";
    rotor.style.transform = "rotate(" + angle + "deg)";
    rotor.dataset.angle = String(angle);
    if (rotor.getBoundingClientRect) rotor.getBoundingClientRect();
    rotor.style.animation = "";
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

  function rewardPercent(claim) {
    var number = Number(claim && claim.percentOff);
    if (!Number.isFinite(number)) return "";
    var rounded = Math.round(number * 100) / 100;
    return String(rounded).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
  }

  function fillResult(root, claim) {
    var code = root.querySelector("[data-pgy-lw-code]");
    var reward = root.querySelector("[data-pgy-lw-reward]");
    if (code) code.textContent = fixedCouponCode(claim);
    if (reward) reward.textContent = "Your reward is " + rewardPercent(claim) + "% OFF";
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
    alignWheel(root, claim, false);
  }

  function alignWheel(root, claim, animate) {
    var rotor = root.querySelector("[data-pgy-lw-rotor]");
    if (!rotor || !claim) return;
    var sector = sectorForReward(claim);
    if (!animate && rotor.dataset.sector === String(sector) && root.dataset.spinning !== "true") {
      return;
    }
    placeWheel(rotor, sector, animate);
    root.dataset.wheelCode = fixedCouponCode(claim);
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
    return Boolean(document.querySelector("[data-pgy-lw-overlay]:not([hidden]), [data-pgy-lw-terms-overlay]:not([hidden])"));
  }

  function lockPage() {
    var root = document.documentElement;
    if (!root.classList.contains("pgy-lw-lock")) {
      var gap = Math.max(0, window.innerWidth - root.clientWidth);
      if (gap > 0) root.style.setProperty("--pgy-lw-scrollbar", gap + "px");
    }
    root.classList.add("pgy-lw-lock");
  }

  function releaseLock() {
    if (anyOverlayOpen()) return;
    var root = document.documentElement;
    root.classList.remove("pgy-lw-lock");
    root.style.removeProperty("--pgy-lw-scrollbar");
  }

  function motionReduced() {
    return Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  function openOverlay(overlay) {
    if (!overlay) return;
    overlay.dataset.closing = "";
    overlay.classList.remove("is-closing");
    overlay.hidden = false;
    if (motionReduced()) {
      overlay.classList.add("is-open");
      return;
    }
    overlay.classList.remove("is-open");
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        overlay.classList.add("is-open");
      });
    });
  }

  function closeOverlay(overlay, done) {
    if (!overlay || overlay.hidden) {
      if (done) done();
      return;
    }
    if (overlay.dataset.closing === "true") return;
    function finish() {
      overlay.dataset.closing = "";
      overlay.classList.remove("is-open", "is-closing");
      overlay.hidden = true;
      if (done) done();
    }
    if (motionReduced() || !overlay.classList.contains("is-open")) {
      finish();
      return;
    }
    overlay.dataset.closing = "true";
    overlay.classList.remove("is-open");
    overlay.classList.add("is-closing");
    var finished = false;
    function end(event) {
      if (event && event.target !== overlay) return;
      if (finished) return;
      finished = true;
      overlay.removeEventListener("transitionend", end);
      finish();
    }
    overlay.addEventListener("transitionend", end);
    window.setTimeout(end, 480);
  }

  function closeModal(root) {
    closeOverlay(root.querySelector("[data-pgy-lw-overlay]"), releaseLock);
  }

  function openTerms(root) {
    var overlay = root.querySelector("[data-pgy-lw-terms-overlay]");
    if (!overlay) return;
    openOverlay(overlay);
    lockPage();
    var close = overlay.querySelector("[data-pgy-lw-terms-close]");
    if (close) window.setTimeout(function () { close.focus(); }, 30);
  }

  function closeTerms(root) {
    closeOverlay(root.querySelector("[data-pgy-lw-terms-overlay]"), releaseLock);
  }

  function setPlayedState(root, claimed, showPlayedCopy) {
    var played = root.querySelector("[data-pgy-lw-played]");
    var email = root.querySelector("[data-pgy-lw-email]");
    var code = root.querySelector("[data-pgy-lw-code]");
    var submit = root.querySelector("[data-pgy-lw-submit]");
    var copy = root.querySelector("[data-pgy-lw-copy]");
    if (played) played.hidden = !(claimed && showPlayedCopy);
    if (email) {
      email.hidden = claimed;
      email.disabled = claimed;
      email.readOnly = claimed;
    }
    if (code) code.hidden = !claimed;
    if (submit) submit.hidden = claimed;
    if (copy) copy.hidden = !claimed;
    if (claimed) root.dataset.played = "true";
    else delete root.dataset.played;
  }

  function showClaimedForm(root, claim, showPlayedCopy) {
    fillResult(root, claim);
    setPlayedState(root, true, Boolean(showPlayedCopy));
    if (root.dataset.spinning !== "true") alignWheel(root, claim, false);
    showMessage(root.querySelector("[data-pgy-lw-message]"), "", false);
  }

  function showFormPanel(root) {
    setPlayedState(root, false);
    showMessage(root.querySelector("[data-pgy-lw-message]"), "", false);
  }

  function openModal(root) {
    var overlay = root.querySelector("[data-pgy-lw-overlay]");
    if (!overlay) return;
    var claimed = Boolean(state.claim && state.claim.couponCode);
    if (claimed) showClaimedForm(root, state.claim, true);
    else showFormPanel(root);
    openOverlay(overlay);
    lockPage();
    var focusTarget = claimed
      ? root.querySelector("[data-pgy-lw-copy]")
      : root.querySelector("[data-pgy-lw-email]");
    if (focusTarget) window.setTimeout(function () { focusTarget.focus(); }, 30);
  }

  function copyCode(root, code) {
    var message = root.querySelector("[data-pgy-lw-copy-message]");
    var strings = stringsFrom(root);
    function done(ok) {
      showMessage(message, ok ? strings.copied : strings.copyFail, !ok);
      var codeEl = root.querySelector("[data-pgy-lw-code]");
      if (ok && codeEl) {
        codeEl.classList.remove("is-copied");
        if (codeEl.getBoundingClientRect) codeEl.getBoundingClientRect();
        codeEl.classList.add("is-copied");
      }
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
        openModal(root);
      });
    });

    root.querySelectorAll("[data-pgy-lw-dot]").forEach(function (button) {
      button.addEventListener("click", function () {
        openModal(root);
      });
    });

    root.querySelectorAll("[data-pgy-lw-close]").forEach(function (button) {
      button.addEventListener("click", function () {
        closeModal(root);
      });
    });

    root.querySelectorAll("[data-pgy-lw-terms]").forEach(function (button) {
      button.addEventListener("click", function () {
        openTerms(root);
      });
    });

    root.querySelectorAll("[data-pgy-lw-terms-close]").forEach(function (button) {
      button.addEventListener("click", function () {
        closeTerms(root);
      });
    });

    var overlay = root.querySelector("[data-pgy-lw-overlay]");
    if (overlay) {
      overlay.addEventListener("click", function (event) {
        if (event.target === overlay) closeModal(root);
      });
    }

    var termsOverlay = root.querySelector("[data-pgy-lw-terms-overlay]");
    if (termsOverlay) {
      termsOverlay.addEventListener("click", function (event) {
        if (event.target === termsOverlay) closeTerms(root);
      });
    }

    var hub = root.querySelector("[data-pgy-lw-hub]");
    if (hub) {
      hub.addEventListener("click", function () {
        if (root.dataset.played === "true") return;
        var spinForm = root.querySelector("[data-pgy-lw-form]");
        if (!spinForm || spinForm.hidden) return;
        if (typeof spinForm.requestSubmit === "function") spinForm.requestSubmit();
        else spinForm.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
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
    if (root.dataset.played === "true" || root.dataset.spinning === "true") return;
    var message = root.querySelector("[data-pgy-lw-message]");
    var emailInput = root.querySelector("[data-pgy-lw-email]");
    var submit = root.querySelector("[data-pgy-lw-submit]");
    var email = emailInput ? emailInput.value.trim() : "";

    if (!EMAIL_PATTERN.test(email)) {
      showMessage(message, strings.invalid, true);
      if (emailInput) emailInput.focus();
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
    var rotor = root.querySelector("[data-pgy-lw-rotor]");
    startIdleSpin(rotor);

    var proxyUrl = root.dataset.proxyUrl || "/apps/pgy-tech/lucky-wheel";
    window.fetch(proxyUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: email,
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
        var overlay = root.querySelector("[data-pgy-lw-overlay]");
        stopIdleSpin(rotor);
        var sector = sectorForReward(data.claim);
        return animateWheel(rotor, sector).then(function () {
          placeWheel(rotor, sector, false);
          root.dataset.spinning = "false";
          root.dataset.wheelCode = fixedCouponCode(data.claim);
          setClaim(data.claim);
          if (overlay && !overlay.hidden) showClaimedForm(root, data.claim, false);
        });
      })
      .catch(function (error) {
        root.dataset.spinning = "false";
        stopIdleSpin(rotor);
        showMessage(message, error && error.message ? error.message : strings.error, true);
      })
      .then(function () {
        if (root.dataset.played === "true") return;
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
    if (stored && stored.couponCode) {
      setClaim(stored);
      return;
    }

    if (!customerEmail || designMode) return;

    window.fetch(withQuery(proxyUrl, { action: "status", email: customerEmail }), {
      headers: { Accept: "application/json" },
    })
      .then(readJson)
      .then(function (data) {
        if (!data || !data.ok) return;
        if (data.claimed && data.claim) setClaim(data.claim);
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
      var terms = root.querySelector("[data-pgy-lw-terms-overlay]");
      if (terms && !terms.hidden) {
        closeTerms(root);
        return;
      }
      var overlay = root.querySelector("[data-pgy-lw-overlay]");
      if (overlay && !overlay.hidden) closeModal(root);
    });
  });

  ready(boot);
})();
