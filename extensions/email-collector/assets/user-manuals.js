(function () {
  var frames = document.querySelectorAll("[data-pgy-user-manuals-frame]");
  if (!frames.length) return;

  function resizeFrame(frame) {
    try {
      var doc = frame.contentDocument || frame.contentWindow.document;
      if (!doc || !doc.documentElement) return;
      var height = Math.max(
        doc.documentElement.scrollHeight,
        doc.body ? doc.body.scrollHeight : 0,
      );
      if (height > 0) {
        frame.style.height = height + "px";
        frame.style.minHeight = "0";
      }
    } catch (error) {
      // Cross-origin storefront setups can keep the configured minimum height.
    }
  }

  frames.forEach(function (frame) {
    frame.addEventListener("load", function () {
      resizeFrame(frame);
      // Recalculate after fonts/images settle.
      window.setTimeout(function () {
        resizeFrame(frame);
      }, 100);
    });
  });
})();
