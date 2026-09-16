import prisma from "../db.server";
import { authenticate, unauthenticated } from "../shopify.server";
import { validateEmail } from "./saved-email.server";

export const CREATOR_STORY_PROXY_PATH = "/apps/pgy-tech/creator-story";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_VIDEO_BYTES = 20 * 1024 * 1024;
const MAX_MEDIA_FILES = 6;

export function hasCreatorStoryModel() {
  return Boolean(prisma.creatorStory);
}

export function isMissingCreatorStoryTableError(error) {
  return (
    error?.code === "P2021" ||
    error?.code === "P2022" ||
    String(error?.message || "").includes("CreatorStory")
  );
}

export function serializeCreatorStory(row) {
  const mediaFiles = normalizeMediaFiles(row.mediaFiles, row);
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    product: row.product,
    orderNumber: row.orderNumber || "",
    country: row.country,
    story: row.story,
    mediaFileId: row.mediaFileId || mediaFiles[0]?.id || "",
    mediaFileUrl: row.mediaFileUrl || mediaFiles[0]?.url || "",
    mediaFileName: row.mediaFileName || mediaFiles[0]?.fileName || "",
    mediaMimeType: row.mediaMimeType || mediaFiles[0]?.mimeType || "",
    mediaFiles,
    allowContentUse: Boolean(row.allowContentUse),
    agreeRules: Boolean(row.agreeRules),
    createdAt: row.createdAt.toISOString(),
  };
}

/** @param {Request} request */
export async function handleCreatorStoryProxyRequest(request) {
  const shopResult = await resolveProxyShop(request);
  if (!shopResult.ok) {
    return jsonResponse(
      { ok: false, message: shopResult.message },
      shopResult.status || 401,
    );
  }

  if (request.method === "GET") {
    return jsonResponse({ ok: true, shop: shopResult.shop });
  }

  if (request.method !== "POST") {
    return jsonResponse({ ok: false, message: "Method not allowed." }, 405);
  }

  const contentType = request.headers.get("content-type") || "";
  let payload;
  try {
    if (contentType.includes("multipart/form-data")) {
      payload = await request.formData();
    } else {
      payload = await request.json();
    }
  } catch {
    return jsonResponse({ ok: false, message: "Invalid request body." }, 400);
  }

  const intent = String(getField(payload, "intent") || "submit").trim();

  try {
    if (intent === "stage") {
      return await handleStageUpload(shopResult.shop, payload);
    }
    if (intent === "commitFile") {
      return await handleCommitFile(shopResult.shop, payload);
    }
    return await handleSubmitStory(shopResult.shop, payload);
  } catch (error) {
    if (isMissingCreatorStoryTableError(error)) {
      return jsonResponse(
        {
          ok: false,
          message:
            "Creator story database is not ready. Please run prisma migrate deploy.",
        },
        503,
      );
    }
    console.error("[creator-story]", error);
    const detail = extractErrorMessage(error);
    const needsFilesScope =
      /write_files|ACCESS_DENIED|access denied|permission/i.test(detail);
    return jsonResponse(
      {
        ok: false,
        message: needsFilesScope
          ? "Missing write_files permission. Reinstall/reauthorize the app, then try again."
          : detail || "Something went wrong. Please try again.",
      },
      500,
    );
  }
}

/**
 * @param {string} shop
 * @param {FormData | Record<string, unknown>} payload
 */
async function handleStageUpload(shop, payload) {
  const filename = String(getField(payload, "filename") || "").trim();
  const mimeType = String(getField(payload, "mimeType") || "").trim();
  const fileSize = Number(getField(payload, "fileSize") || 0);

  const mediaCheck = validateMediaMeta({ filename, mimeType, fileSize });
  if (!mediaCheck.ok) {
    return jsonResponse({ ok: false, message: mediaCheck.message }, 400);
  }

  const admin = await getAdminForShop(shop);
  const staged = await createStagedUpload(admin, {
    filename: mediaCheck.filename,
    mimeType: mediaCheck.mimeType,
    fileSize: mediaCheck.fileSize,
    resource: mediaCheck.resource,
  });

  if (!staged.ok) {
    return jsonResponse({ ok: false, message: staged.message }, 502);
  }

  return jsonResponse({
    ok: true,
    upload: {
      url: staged.url,
      resourceUrl: staged.resourceUrl,
      parameters: staged.parameters,
      resource: mediaCheck.resource,
      contentType: mediaCheck.contentType,
      filename: mediaCheck.filename,
      mimeType: mediaCheck.mimeType,
    },
  });
}

/**
 * Finalize a staged upload into Shopify Files and return the file record.
 * @param {string} shop
 * @param {FormData | Record<string, unknown>} payload
 */
async function handleCommitFile(shop, payload) {
  const resourceUrl = String(getField(payload, "resourceUrl") || "").trim();
  const filename = String(getField(payload, "filename") || "").trim();
  const mimeType = String(getField(payload, "mimeType") || "").trim();
  const contentType = String(getField(payload, "contentType") || "").trim();
  const alt = String(getField(payload, "alt") || "Creator story media").trim();

  if (!resourceUrl) {
    return jsonResponse({ ok: false, message: "Missing upload resource." }, 400);
  }

  const admin = await getAdminForShop(shop);
  const fileResult = await createShopifyFile(admin, {
    originalSource: resourceUrl,
    contentType: contentType || guessContentType(mimeType),
    alt,
    filename,
  });

  if (!fileResult.ok) {
    return jsonResponse({ ok: false, message: fileResult.message }, 502);
  }

  return jsonResponse({
    ok: true,
    file: {
      id: fileResult.id,
      url: fileResult.url,
      fileName: filename || fileResult.filename || "",
      mimeType: mimeType || "",
    },
  });
}

/**
 * @param {string} shop
 * @param {FormData | Record<string, unknown>} payload
 */
async function handleSubmitStory(shop, payload) {
  if (!hasCreatorStoryModel()) {
    return jsonResponse(
      {
        ok: false,
        message:
          "Creator story database is not ready. Please run prisma migrate deploy.",
      },
      503,
    );
  }

  const name = String(getField(payload, "name") || "").trim();
  const email = String(getField(payload, "email") || "").trim().toLowerCase();
  const orderNumber = String(getField(payload, "orderNumber") || "").trim();
  const country = String(getField(payload, "country") || "").trim();
  const story = String(getField(payload, "story") || "").trim();
  const allowContentUse =
    getField(payload, "allowContentUse") === "true" ||
    getField(payload, "allowContentUse") === "on" ||
    getField(payload, "allowContentUse") === true;
  const agreeRules =
    getField(payload, "agreeRules") === "true" ||
    getField(payload, "agreeRules") === "on" ||
    getField(payload, "agreeRules") === true;

  const rawMediaItems = getField(payload, "mediaItems");
  let mediaItems = [];
  if (Array.isArray(rawMediaItems)) {
    mediaItems = rawMediaItems;
  } else if (typeof rawMediaItems === "string" && rawMediaItems.trim()) {
    try {
      const parsed = JSON.parse(rawMediaItems);
      if (Array.isArray(parsed)) mediaItems = parsed;
    } catch {
      mediaItems = [];
    }
  }

  // Backward compatible single-file payload
  const resourceUrl = String(getField(payload, "resourceUrl") || "").trim();
  if (!mediaItems.length && resourceUrl) {
    mediaItems = [
      {
        resourceUrl,
        filename: String(getField(payload, "mediaFilename") || "").trim(),
        mimeType: String(getField(payload, "mediaMimeType") || "").trim(),
        contentType: String(getField(payload, "mediaContentType") || "").trim(),
      },
    ];
  }

  if (!name) {
    return jsonResponse({ ok: false, message: "Please enter your name." }, 400);
  }
  if (!validateEmail(email)) {
    return jsonResponse(
      { ok: false, message: "Please enter a valid email address." },
      400,
    );
  }
  if (!country) {
    return jsonResponse(
      { ok: false, message: "Please enter your country / region." },
      400,
    );
  }

  if (!story) {
    return jsonResponse(
      { ok: false, message: "Please share your experience." },
      400,
    );
  }

  if (!allowContentUse || !agreeRules) {
    return jsonResponse(
      {
        ok: false,
        message: "Please agree to the content use and event rules.",
      },
      400,
    );
  }

  if (!mediaItems.length) {
    return jsonResponse(
      { ok: false, message: "Please upload a photo or a video." },
      400,
    );
  }
  if (mediaItems.length > MAX_MEDIA_FILES) {
    return jsonResponse(
      {
        ok: false,
        message: `You can upload up to ${MAX_MEDIA_FILES} files.`,
      },
      400,
    );
  }

  const admin = await getAdminForShop(shop);
  const savedMedia = [];

  for (let index = 0; index < mediaItems.length; index += 1) {
    const item = mediaItems[index] || {};
    const existingId = String(item.id || "").trim();
    const existingUrl = String(item.url || "").trim();
    const itemFilename = String(
      item.fileName || item.filename || item.mediaFilename || "",
    ).trim();
    const itemMimeType = String(
      item.mimeType || item.mediaMimeType || "",
    ).trim();

    if (existingId) {
      savedMedia.push({
        id: existingId,
        url: existingUrl,
        fileName: itemFilename,
        mimeType: itemMimeType,
      });
      continue;
    }

    const itemResourceUrl = String(item.resourceUrl || "").trim();
    const itemContentType = String(
      item.contentType || item.mediaContentType || "",
    ).trim();

    if (!itemResourceUrl) {
      return jsonResponse(
        { ok: false, message: "Please upload a photo or a video." },
        400,
      );
    }

    const fileResult = await createShopifyFile(admin, {
      originalSource: itemResourceUrl,
      contentType: itemContentType || guessContentType(itemMimeType),
      alt: `Creator story by ${name} (${index + 1})`,
      filename: itemFilename,
    });

    if (!fileResult.ok) {
      return jsonResponse(
        {
          ok: false,
          message: fileResult.message || `Failed to save file ${index + 1}.`,
        },
        502,
      );
    }

    savedMedia.push({
      id: fileResult.id,
      url: fileResult.url,
      fileName: itemFilename || fileResult.filename || "",
      mimeType: itemMimeType || "",
    });
  }

  const first = savedMedia[0];
  const row = await prisma.creatorStory.create({
    data: {
      shop,
      name,
      email,
      product: "",
      orderNumber: orderNumber || null,
      country,
      story,
      mediaFileId: first?.id || null,
      mediaFileUrl: first?.url || null,
      mediaFileName: first?.fileName || null,
      mediaMimeType: first?.mimeType || null,
      mediaFiles: savedMedia,
      allowContentUse,
      agreeRules,
    },
  });

  return jsonResponse({
    ok: true,
    message: "Thanks! Your story has been submitted.",
    story: serializeCreatorStory(row),
  });
}

/**
 * @param {import("@shopify/shopify-app-react-router/server").AdminApiContext} admin
 * @param {{ filename: string, mimeType: string, fileSize: number, resource: string }} input
 */
async function createStagedUpload(admin, input) {
  const response = await admin.graphql(
    `#graphql
      mutation CreatorStoryStagedUploads($input: [StagedUploadInput!]!) {
        stagedUploadsCreate(input: $input) {
          stagedTargets {
            url
            resourceUrl
            parameters {
              name
              value
            }
          }
          userErrors {
            field
            message
          }
        }
      }`,
    {
      variables: {
        input: [
          {
            filename: input.filename,
            mimeType: input.mimeType,
            fileSize: String(input.fileSize),
            httpMethod: "POST",
            resource: input.resource,
          },
        ],
      },
    },
  );

  const json = await response.json();
  const payload = json.data?.stagedUploadsCreate;
  const userError = payload?.userErrors?.[0]?.message || firstGraphqlError(json);
  if (userError) {
    console.error("[creator-story-stage]", userError, JSON.stringify(json));
    return { ok: false, message: userError };
  }

  const target = payload?.stagedTargets?.[0];
  if (!target?.url || !target?.resourceUrl) {
    return { ok: false, message: "Failed to create upload target." };
  }

  return {
    ok: true,
    url: target.url,
    resourceUrl: target.resourceUrl,
    parameters: target.parameters || [],
  };
}

/**
 * @param {import("@shopify/shopify-app-react-router/server").AdminApiContext} admin
 * @param {{ originalSource: string, contentType: string, alt: string, filename?: string }} input
 */
async function createShopifyFile(admin, input) {
  const response = await admin.graphql(
    `#graphql
      mutation CreatorStoryFileCreate($files: [FileCreateInput!]!) {
        fileCreate(files: $files) {
          files {
            id
            fileStatus
            alt
            ... on MediaImage {
              image {
                url
              }
            }
            ... on Video {
              filename
              sources {
                url
                format
              }
            }
            ... on GenericFile {
              url
            }
          }
          userErrors {
            field
            message
          }
        }
      }`,
    {
      variables: {
        files: [
          {
            originalSource: input.originalSource,
            contentType: input.contentType,
            alt: input.alt,
            // Do not pass filename: Shopify requires its extension to match
            // the staged originalSource, which often differs from the local name.
          },
        ],
      },
    },
  );

  const json = await response.json();
  const payload = json.data?.fileCreate;
  const userError = payload?.userErrors?.[0]?.message || firstGraphqlError(json);
  if (userError) {
    console.error("[creator-story-file]", userError, JSON.stringify(json));
    return { ok: false, message: userError };
  }

  const file = payload?.files?.[0];
  if (!file?.id) {
    return { ok: false, message: "Failed to create Shopify file." };
  }

  const url =
    file.image?.url ||
    file.url ||
    file.sources?.[0]?.url ||
    input.originalSource;

  return {
    ok: true,
    id: file.id,
    url,
    filename: file.filename || input.filename || "",
  };
}

/** @param {{ filename: string, mimeType: string, fileSize: number }} meta */
function validateMediaMeta(meta) {
  const filename = String(meta.filename || "").trim();
  const mimeType = String(meta.mimeType || "").trim().toLowerCase();
  const fileSize = Number(meta.fileSize || 0);

  if (!filename || !mimeType || !Number.isFinite(fileSize) || fileSize <= 0) {
    return { ok: false, message: "Invalid upload file." };
  }

  const isImage = mimeType.startsWith("image/");
  const isVideo = mimeType.startsWith("video/");
  if (!isImage && !isVideo) {
    return {
      ok: false,
      message: "Only image and video files are allowed.",
    };
  }

  const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (fileSize > maxBytes) {
    return {
      ok: false,
      message: isVideo
        ? "Each video must be 20MB or smaller."
        : "Each image must be 5MB or smaller.",
    };
  }

  return {
    ok: true,
    filename: sanitizeFilename(filename, mimeType),
    mimeType,
    fileSize,
    resource: isVideo ? "VIDEO" : "IMAGE",
    contentType: isVideo ? "VIDEO" : "IMAGE",
  };
}

/** @param {string} mimeType */
function guessContentType(mimeType) {
  const value = String(mimeType || "").toLowerCase();
  if (value.startsWith("video/")) return "VIDEO";
  if (value.startsWith("image/")) return "IMAGE";
  return "FILE";
}

/** @param {string} filename @param {string} mimeType */
function sanitizeFilename(filename, mimeType = "") {
  let base = String(filename || "upload")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .trim();
  if (!base) base = "upload";

  const extFromName = (base.match(/\.([a-z0-9]+)$/i) || [])[1] || "";
  const extFromMime = extensionFromMime(mimeType);
  if (extFromMime && extFromName.toLowerCase() !== extFromMime.toLowerCase()) {
    base = `${base.replace(/\.[a-z0-9]+$/i, "")}.${extFromMime}`;
  } else if (!extFromName && extFromMime) {
    base = `${base}.${extFromMime}`;
  }

  return base.slice(0, 180) || `upload.${extFromMime || "bin"}`;
}

/** @param {string} mimeType */
function extensionFromMime(mimeType) {
  const value = String(mimeType || "").toLowerCase();
  const map = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/heif": "heif",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
    "video/x-msvideo": "avi",
  };
  return map[value] || "";
}

/**
 * @param {unknown} raw
 * @param {{ mediaFileId?: string | null, mediaFileUrl?: string | null, mediaFileName?: string | null, mediaMimeType?: string | null }} row
 */
function normalizeMediaFiles(raw, row) {
  if (Array.isArray(raw) && raw.length) {
    return raw
      .map((item) => ({
        id: String(item?.id || ""),
        url: String(item?.url || ""),
        fileName: String(item?.fileName || item?.filename || ""),
        mimeType: String(item?.mimeType || ""),
      }))
      .filter((item) => item.url || item.id);
  }

  if (row?.mediaFileUrl || row?.mediaFileId) {
    return [
      {
        id: row.mediaFileId || "",
        url: row.mediaFileUrl || "",
        fileName: row.mediaFileName || "",
        mimeType: row.mediaMimeType || "",
      },
    ];
  }

  return [];
}

/** @param {Request} request */
async function resolveProxyShop(request) {
  try {
    const { session } = await authenticate.public.appProxy(request);
    const shop = session?.shop || new URL(request.url).searchParams.get("shop");
    if (!shop) {
      return { ok: false, status: 401, message: "Unable to identify shop." };
    }
    return { ok: true, shop };
  } catch (error) {
    if (error instanceof Response) {
      return {
        ok: false,
        status: 401,
        message:
          "App Proxy validation failed. Please test on the live storefront.",
      };
    }
    throw error;
  }
}

/** @param {string} shop */
async function getAdminForShop(shop) {
  const { admin } = await unauthenticated.admin(shop);
  return admin;
}

/**
 * @param {FormData | Record<string, unknown>} payload
 * @param {string} key
 */
function getField(payload, key) {
  if (payload instanceof FormData) {
    return payload.get(key);
  }
  return payload?.[key];
}

/** @param {unknown} json */
function firstGraphqlError(json) {
  const errors = json?.errors;
  if (Array.isArray(errors) && errors[0]) {
    const first = errors[0];
    if (typeof first === "string") return first;
    return String(first?.message || "");
  }
  return "";
}

/** @param {unknown} error */
function extractErrorMessage(error) {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "object" && error.message) return String(error.message);
  try {
    return JSON.stringify(error);
  } catch {
    return "";
  }
}

/** @param {unknown} body @param {number} [status] */
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
