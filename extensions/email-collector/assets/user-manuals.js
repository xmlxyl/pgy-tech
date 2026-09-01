(function () {
  var frames = document.querySelectorAll("[data-pgy-user-manuals-frame]");
  if (!frames.length) return;

  frames.forEach(function (frame) {
    frame.addEventListener("load", function () {
      try {
        var doc = frame.contentDocument || frame.contentWindow.document;
        if (!doc || !doc.documentElement) return;
        var height = Math.max(
          doc.documentElement.scrollHeight,
          doc.body ? doc.body.scrollHeight : 0,
        );
        if (height > 0) frame.style.minHeight = height + "px";
      } catch (error) {
        // Cross-origin storefront setups can keep the configured minimum height.
      }
    });
  });
})();
