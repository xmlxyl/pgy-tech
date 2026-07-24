"use strict";

(function () {
  try {
    if (window.__pgyTieredGiftMainLoaded) return;
    window.__pgyTieredGiftMainLoaded = true;

    var current = document.currentScript;
    if (!current || !current.src) return;

    var mainSrc = current.src.replace(/[^/]*$/, "tiered-gift-banner.js");
    var s = document.createElement("script");
    s.src = mainSrc;
    s.async = true;
    document.head.appendChild(s);
  } catch (e) {}
})();
