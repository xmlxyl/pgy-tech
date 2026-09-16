(function () {
  var roots = document.querySelectorAll("[data-pgy-creator-story]");
  if (!roots.length) return;

  var MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  var MAX_VIDEO_BYTES = 20 * 1024 * 1024;
  var MAX_MEDIA_FILES = 6;

  Array.prototype.forEach.call(roots, initRoot);

  function initRoot(root) {
    var form = root.querySelector("[data-pgy-cs-form]");
    if (!form || form.dataset.pgyBound) return;
    form.dataset.pgyBound = "1";

    var mediaInput = form.querySelector("[data-pgy-cs-media]");
    var mediaLabel = form.querySelector("[data-pgy-cs-media-label]");
    var previewsEl = form.querySelector("[data-pgy-cs-previews]");
    var submitBtn = form.querySelector("[data-pgy-cs-submit]");
    var messageEl = form.querySelector("[data-pgy-cs-message]");
    var proxyUrl = root.getAttribute("data-proxy-url") || "/apps/pgy-tech/creator-story";
    var defaultUploadText =
      (mediaLabel && mediaLabel.textContent) || "Upload photos or videos (max 6)";
    /** @type {Array<{localId:string,id:string,url:string,previewUrl:string,fileName:string,mimeType:string,uploading?:boolean,error?:string}>} */
    var uploadedMedia = [];
    var uploadBusy = false;

    if (mediaInput) {
      mediaInput.addEventListener("change", function () {
        handleMediaSelect();
      });
    }

    if (previewsEl) {
      previewsEl.addEventListener("click", function (event) {
        var target = event.target;
        if (!target || !target.getAttribute) return;
        var removeId = target.getAttribute("data-pgy-cs-remove");
        if (!removeId) return;
        uploadedMedia = uploadedMedia.filter(function (item) {
          if (item.localId === removeId) {
            if (item.previewUrl && item.previewUrl.indexOf("blob:") === 0) {
              try {
                URL.revokeObjectURL(item.previewUrl);
              } catch (e) {}
            }
            if (item.sourceUrl && item.sourceUrl.indexOf("blob:") === 0) {
              try {
                URL.revokeObjectURL(item.sourceUrl);
              } catch (e) {}
            }
          }
          return item.localId !== removeId;
        });
        renderPreviews();
        updateUploadLabel();
      });
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      submitForm();
    });

    async function handleMediaSelect() {
      var files = getSelectedFiles();
      if (!files.length) return;

      clearMessage();
      var remaining = MAX_MEDIA_FILES - uploadedMedia.length;
      if (remaining <= 0) {
        showMessage(
          msg("data-msg-media-limit") ||
            "You can upload up to " + MAX_MEDIA_FILES + " files.",
        );
        mediaInput.value = "";
        return;
      }

      var queue = files.slice(0, remaining);
      var sizeError = validateLocalFiles(queue);
      if (sizeError) {
        showMessage(sizeError);
        mediaInput.value = "";
        return;
      }

      // Show all previews immediately, then upload in parallel.
      var pendingItems = queue.map(function (file, index) {
        return createPendingItem(file, index);
      });
      uploadedMedia = uploadedMedia.concat(pendingItems);
      renderPreviews();
      updateUploadLabel();

      pendingItems.forEach(function (pending) {
        if (String(pending.mimeType || "").indexOf("video/") === 0) {
          captureVideoThumbnail(pending);
        }
      });

      uploadBusy = true;
      setBusy(
        true,
        (msg("data-msg-uploading") || "Uploading media…") +
          " (" +
          pendingItems.length +
          ")",
      );

      try {
        var results = await Promise.all(
          pendingItems.map(function (pending) {
            return uploadPendingItem(pending).then(
              function () {
                return { ok: true, pending: pending };
              },
              function (error) {
                pending.uploading = false;
                pending.error =
                  (error && error.message) || msg("data-msg-error");
                renderPreviews();
                return { ok: false, pending: pending, error: error };
              },
            );
          }),
        );

        var failed = results.filter(function (result) {
          return !result.ok;
        });
        if (failed.length) {
          var firstError =
            (failed[0].error && failed[0].error.message) ||
            failed[0].pending.error ||
            msg("data-msg-error");
          if (isPreviewError(failed[0].error)) {
            showMessage(msg("data-msg-preview"));
          } else if (failed.length === results.length) {
            showMessage(firstError);
          } else {
            showMessage(
              failed.length +
                " file(s) failed to upload. " +
                firstError,
            );
          }
        }
      } catch (error) {
        console.error("[pgy-creator-story]", error);
        if (isPreviewError(error)) {
          showMessage(msg("data-msg-preview"));
        } else {
          showMessage(
            error && error.message ? error.message : msg("data-msg-error"),
          );
        }
      } finally {
        uploadBusy = false;
        setBusy(false);
        mediaInput.value = "";
        updateUploadLabel();
      }
    }

    function createPendingItem(file, index) {
      var isVideo = String(file.type || "").indexOf("video/") === 0;
      return {
        localId:
          "local-" +
          Date.now() +
          "-" +
          index +
          "-" +
          Math.random().toString(36).slice(2, 8),
        id: "",
        url: "",
        previewUrl: isVideo ? "" : URL.createObjectURL(file),
        sourceUrl: isVideo ? URL.createObjectURL(file) : "",
        fileName: file.name,
        mimeType: file.type || "",
        uploading: true,
        file: file,
      };
    }

    function captureVideoThumbnail(pending) {
      if (!pending.sourceUrl) return;
      var video = document.createElement("video");
      var done = false;
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      video.src = pending.sourceUrl;

      var finish = function (dataUrl) {
        if (done) return;
        done = true;
        if (dataUrl) pending.previewUrl = dataUrl;
        renderPreviews();
      };

      var onSeeked = function () {
        try {
          var canvas = document.createElement("canvas");
          var width = video.videoWidth || 320;
          var height = video.videoHeight || 180;
          canvas.width = width;
          canvas.height = height;
          var ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(video, 0, 0, width, height);
            finish(canvas.toDataURL("image/jpeg", 0.72));
          } else {
            finish("");
          }
        } catch (e) {
          finish("");
        }
      };

      video.addEventListener("loadeddata", function () {
        try {
          video.currentTime = Math.min(0.1, (video.duration || 1) * 0.05 || 0.1);
        } catch (e) {
          onSeeked();
        }
      });
      video.addEventListener("seeked", onSeeked);
      video.addEventListener("error", function () {
        finish("");
      });
    }

    async function uploadPendingItem(pending) {
      var file = pending.file;
      var sourceUrl = pending.sourceUrl || pending.previewUrl;

      var stage = await stageUpload(file);
      if (!stage.ok) {
        throw new Error(stage.message || msg("data-msg-error"));
      }

      await uploadToStagedTarget(stage.upload, file);

      var committed = await postJson({
        intent: "commitFile",
        resourceUrl: stage.upload.resourceUrl,
        filename: stage.upload.filename || file.name,
        mimeType: stage.upload.mimeType || file.type,
        contentType: stage.upload.contentType,
        alt: "Creator story media",
      });

      if (!committed.ok || !committed.file) {
        throw new Error(committed.message || msg("data-msg-error"));
      }

      pending.uploading = false;
      pending.id = committed.file.id || "";
      pending.url = committed.file.url || "";
      pending.fileName = committed.file.fileName || file.name;
      pending.mimeType = committed.file.mimeType || file.type || "";
      pending.file = null;

      var isVideo = String(pending.mimeType || "").indexOf("video/") === 0;
      if (!isVideo && pending.url) {
        if (pending.previewUrl && pending.previewUrl.indexOf("blob:") === 0) {
          try {
            URL.revokeObjectURL(pending.previewUrl);
          } catch (e) {}
        }
        pending.previewUrl = pending.url;
      }
      if (sourceUrl && sourceUrl.indexOf("blob:") === 0) {
        try {
          URL.revokeObjectURL(sourceUrl);
        } catch (e) {}
        pending.sourceUrl = "";
      }
      renderPreviews();
    }

    function renderPreviews() {
      if (!previewsEl) return;
      if (!uploadedMedia.length) {
        previewsEl.hidden = true;
        previewsEl.innerHTML = "";
        return;
      }

      previewsEl.hidden = false;
      previewsEl.innerHTML = uploadedMedia
        .map(function (item) {
          var isVideo = String(item.mimeType || "").indexOf("video/") === 0;
          var thumbSrc = item.previewUrl || "";
          var mediaHtml = thumbSrc
            ? '<img class="pgy-creator-story__preview-media" src="' +
              escapeAttr(thumbSrc) +
              '" alt="' +
              escapeAttr(item.fileName || "upload") +
              '">'
            : '<div class="pgy-creator-story__preview-media pgy-creator-story__preview-media--empty" aria-hidden="true"></div>';
          var videoBadge = isVideo
            ? '<span class="pgy-creator-story__preview-badge">VIDEO</span>'
            : "";
          var status = item.uploading
            ? '<span class="pgy-creator-story__preview-status">Uploading…</span>'
            : item.error
              ? '<span class="pgy-creator-story__preview-status is-error">' +
                escapeHtml(item.error) +
                "</span>"
              : "";
          return (
            '<div class="pgy-creator-story__preview' +
            (isVideo ? " is-video" : "") +
            (item.uploading ? " is-uploading" : "") +
            (item.error ? " is-error" : "") +
            '" data-local-id="' +
            escapeAttr(item.localId) +
            '">' +
            mediaHtml +
            videoBadge +
            status +
            '<button type="button" class="pgy-creator-story__preview-remove" data-pgy-cs-remove="' +
            escapeAttr(item.localId) +
            '" aria-label="Remove">×</button>' +
            "</div>"
          );
        })
        .join("");
    }

    function updateUploadLabel() {
      var upload = form.querySelector(".pgy-creator-story__upload");
      var readyCount = uploadedMedia.filter(function (item) {
        return item.id && !item.error;
      }).length;
      if (!readyCount) {
        if (mediaLabel) mediaLabel.textContent = defaultUploadText;
        if (upload) upload.classList.remove("has-file");
        return;
      }
      if (mediaLabel) {
        mediaLabel.textContent =
          readyCount === 1
            ? "1 file uploaded"
            : readyCount + " files uploaded";
      }
      if (upload) upload.classList.add("has-file");
    }

    function getSelectedFiles() {
      if (!mediaInput || !mediaInput.files || !mediaInput.files.length) {
        return [];
      }
      return Array.prototype.slice.call(mediaInput.files, 0);
    }

    async function submitForm() {
      clearMessage();
      if (uploadBusy) {
        return showMessage(msg("data-msg-uploading") || "Uploading media…");
      }

      var name = valueOf("data-pgy-cs-name");
      var email = valueOf("data-pgy-cs-email");
      var orderNumber = valueOf("data-pgy-cs-order");
      var country = valueOf("data-pgy-cs-country");
      var story = valueOf("data-pgy-cs-story");
      var allow = form.querySelector("[data-pgy-cs-allow]");
      var rules = form.querySelector("[data-pgy-cs-rules]");
      var mediaItems = uploadedMedia.filter(function (item) {
        return item.id && !item.error && !item.uploading;
      });

      if (!name) return showMessage(msg("data-msg-name"));
      if (!isValidEmail(email)) return showMessage(msg("data-msg-email"));
      if (!country) return showMessage(msg("data-msg-country"));
      if (!story) return showMessage(msg("data-msg-story"));
      if (!mediaItems.length) return showMessage(msg("data-msg-media"));
      if (!(allow && allow.checked && rules && rules.checked)) {
        return showMessage(msg("data-msg-agree"));
      }

      setBusy(true, msg("data-msg-submitting") || "Submitting…");

      try {
        var submitResult = await postJson({
          intent: "submit",
          name: name,
          email: email,
          orderNumber: orderNumber,
          country: country,
          story: story,
          allowContentUse: true,
          agreeRules: true,
          mediaItems: mediaItems.map(function (item) {
            return {
              id: item.id,
              url: item.url || item.previewUrl,
              fileName: item.fileName,
              mimeType: item.mimeType,
            };
          }),
        });

        if (!submitResult.ok) {
          showMessage(submitResult.message || msg("data-msg-error"));
          return;
        }

        uploadedMedia.forEach(function (item) {
          if (item.previewUrl && item.previewUrl.indexOf("blob:") === 0) {
            try {
              URL.revokeObjectURL(item.previewUrl);
            } catch (e) {}
          }
          if (item.sourceUrl && item.sourceUrl.indexOf("blob:") === 0) {
            try {
              URL.revokeObjectURL(item.sourceUrl);
            } catch (e) {}
          }
        });
        uploadedMedia = [];
        form.reset();
        if (allow) allow.checked = true;
        if (rules) rules.checked = true;
        renderPreviews();
        updateUploadLabel();
        showMessage(
          submitResult.message || msg("data-msg-success") || "Thanks!",
          true,
        );
      } catch (error) {
        console.error("[pgy-creator-story]", error);
        if (isPreviewError(error)) {
          showMessage(msg("data-msg-preview"));
        } else {
          showMessage(
            error && error.message ? error.message : msg("data-msg-error"),
          );
        }
      } finally {
        setBusy(false);
      }
    }

    function validateLocalFiles(files) {
      for (var i = 0; i < files.length; i += 1) {
        var file = files[i];
        var mime = String(file.type || "").toLowerCase();
        var isImage = mime.indexOf("image/") === 0;
        var isVideo = mime.indexOf("video/") === 0;
        if (!isImage && !isVideo) {
          return (
            msg("data-msg-media-type") ||
            "Only image and video files are allowed."
          );
        }
        if (isImage && file.size > MAX_IMAGE_BYTES) {
          return (
            msg("data-msg-image-size") ||
            "Each image must be 5MB or smaller."
          );
        }
        if (isVideo && file.size > MAX_VIDEO_BYTES) {
          return (
            msg("data-msg-video-size") ||
            "Each video must be 20MB or smaller."
          );
        }
      }
      return "";
    }

    async function stageUpload(file) {
      return postJson({
        intent: "stage",
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        fileSize: file.size,
      });
    }

    async function uploadToStagedTarget(upload, file) {
      var formData = new FormData();
      var params = upload.parameters || [];
      for (var i = 0; i < params.length; i += 1) {
        formData.append(params[i].name, params[i].value);
      }
      formData.append("file", file, upload.filename || file.name);

      var response = await fetch(upload.url, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        var text = "";
        try {
          text = await response.text();
        } catch (e) {
          text = "";
        }
        throw new Error(
          text || "Media upload failed. Please try a smaller file.",
        );
      }
    }

    async function postJson(body) {
      var response = await fetch(proxyUrl, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        credentials: "same-origin",
      });

      var data = null;
      try {
        data = await response.json();
      } catch (e) {
        data = null;
      }

      if (!response.ok) {
        return {
          ok: false,
          message:
            (data && data.message) ||
            (response.status === 401
              ? msg("data-msg-preview")
              : msg("data-msg-error")),
        };
      }

      return data || { ok: false, message: msg("data-msg-error") };
    }

    function valueOf(selector) {
      var el = form.querySelector("[" + selector + "]");
      return el && typeof el.value === "string" ? el.value.trim() : "";
    }

    function msg(attr) {
      return root.getAttribute(attr) || "";
    }

    function showMessage(text, success) {
      if (!messageEl) return;
      messageEl.hidden = !text;
      messageEl.textContent = text || "";
      messageEl.classList.toggle("is-success", Boolean(success));
    }

    function clearMessage() {
      showMessage("", false);
      if (messageEl) messageEl.hidden = true;
    }

    function setBusy(busy, label) {
      if (!submitBtn) return;
      submitBtn.disabled = Boolean(busy);
      if (mediaInput) mediaInput.disabled = Boolean(busy);
      if (busy && label) {
        submitBtn.dataset.originalLabel =
          submitBtn.dataset.originalLabel || submitBtn.textContent;
        submitBtn.textContent = label;
      } else if (submitBtn.dataset.originalLabel) {
        submitBtn.textContent = submitBtn.dataset.originalLabel;
      }
    }

    function escapeAttr(value) {
      return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }

    function escapeHtml(value) {
      return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
  }

  function isPreviewError(error) {
    var message = String((error && error.message) || "");
    return /app proxy|401|preview/i.test(message);
  }
})();
