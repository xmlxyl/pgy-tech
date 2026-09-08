(function () {
  var SOURCE = "pgy-user-manuals";
  var frames = Array.prototype.slice.call(
    document.querySelectorAll("[data-pgy-user-manuals-frame]"),
  );
  if (!frames.length) return;

  function applyHeight(frame, height) {
    var next = Math.max(0, Math.ceil(Number(height) || 0));
    if (!next) return;
    frame.style.height = next + "px";
    frame.style.minHeight = "0";
  }

  function resizeFromDocument(frame) {
    try {
      var doc = frame.contentDocument || frame.contentWindow.document;
      if (!doc) return;
      var page = doc.querySelector(".manual-page");
      var height = 0;
      if (page) {
        height = page.offsetTop + page.offsetHeight;
      } else {
        height = Math.max(
          doc.documentElement ? doc.documentElement.scrollHeight : 0,
          doc.body ? doc.body.scrollHeight : 0,
        );
      }
      applyHeight(frame, height);
    } catch (error) {
      // Cross-origin: rely on postMessage from the iframe.
    }
  }

  window.addEventListener("message", function (event) {
    var data = event && event.data;
    if (!data || data.source !== SOURCE || data.type !== "resize") return;

    frames.forEach(function (frame) {
      if (frame.contentWindow === event.source) {
        applyHeight(frame, data.height);
      }
    });
  });

  frames.forEach(function (frame) {
    frame.addEventListener("load", function () {
      resizeFromDocument(frame);
      window.setTimeout(function () {
        resizeFromDocument(frame);
      }, 120);
    });
  });
})();
