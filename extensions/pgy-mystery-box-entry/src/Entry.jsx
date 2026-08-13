/** @jsxImportSource preact */
import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

const ENTRY_API_ORIGIN = "https://pgy-tech.vercel.app";
const ENTRY_CONFIG_PATH = "/apps/pgy-tech/mystery-box-entry";
const MYSTERY_BOX_PATH = "/apps/pgy-tech/mystery-box";
const FALLBACK_MIN_ORDER_AMOUNT = 159;

function getQualifiedMessage() {
  return "Congratulations! Your purchase unlocks an exclusive reward. Open your mystery box now.";
}

function getMinimumMessage(minOrderAmount) {
  return `Orders over ${minOrderAmount} can earn one lucky box draw chance.`;
}

function getClaimedMessage() {
  return "You've already claimed your reward for this order. Thank you for participating!";
}

function getStorefrontOrigin() {
  const storefrontUrl = shopify.shop?.storefrontUrl;
  if (storefrontUrl) {
    try {
      return new URL(storefrontUrl).origin;
    } catch {
      // Fall through to the myshopify domain fallback.
    }
  }

  const myshopifyDomain = shopify.shop?.myshopifyDomain;
  return myshopifyDomain ? `https://${myshopifyDomain}` : "";
}

function getMyshopifyDomain() {
  return shopify.shop?.myshopifyDomain || "";
}

function buildMysteryBoxUrl(storefrontOrigin) {
  if (!storefrontOrigin) return MYSTERY_BOX_PATH;
  return new URL(MYSTERY_BOX_PATH, storefrontOrigin).toString();
}

export function renderEntry({
  getOrderId,
  getOrderName,
  getOrderTotal,
  getOrderLines,
  getOrderProcessedAt,
}) {
  render(
    <MysteryBoxEntry
      getOrderId={getOrderId}
      getOrderName={getOrderName}
      getOrderTotal={getOrderTotal}
      getOrderLines={getOrderLines}
      getOrderProcessedAt={getOrderProcessedAt}
    />,
    document.body,
  );
}

/* eslint-disable react/prop-types */
function MysteryBoxEntry({
  getOrderId,
  getOrderName,
  getOrderTotal,
  getOrderLines,
  getOrderProcessedAt,
}) {
  const isEditor = Boolean(shopify.editor);
  const orderId = getOrderId?.() || "";
  const orderName = getOrderName?.() || "";
  const orderTotal = getOrderTotal();
  const orderLines = getOrderLines?.() || [];
  const orderProcessedAt = getOrderProcessedAt?.() || "";
  const storefrontOrigin = getStorefrontOrigin();
  const [config, setConfig] = useState({
    loading: true,
    activityStartBeijing: "",
    minOrderAmount: FALLBACK_MIN_ORDER_AMOUNT,
  });

  useEffect(() => {
    let active = true;

    async function loadConfig() {
      try {
        const shop = getMyshopifyDomain();
        const url = new URL(ENTRY_CONFIG_PATH, ENTRY_API_ORIGIN);
        url.searchParams.set("mode", "config");
        if (shop) url.searchParams.set("shop", shop);

        console.log("PGY mystery box entry config fetching", {
          url: url.toString(),
          shop,
        });

        const response = await fetch(url.toString());
        const data = await response.json();
        console.log("PGY mystery box entry config status", data);

        if (!active) return;
        setConfig({
          loading: false,
          activityStartBeijing: data.startDateBeijing || "",
          minOrderAmount:
            Number(data.minOrderAmount) || FALLBACK_MIN_ORDER_AMOUNT,
        });
      } catch (error) {
        console.error("PGY mystery box entry config failed", error);
        if (active) {
          setConfig((current) => ({ ...current, loading: false }));
        }
      }
    }

    loadConfig();

    return () => {
      active = false;
    };
  }, []);

  const afterActivityStart = isAfterActivityStart(
    orderProcessedAt,
    config.activityStartBeijing,
  );
  const eligible = orderTotal.amount >= config.minOrderAmount;
  const alreadyClaimed = hasClaimedPrizeLine(orderLines);
  const show = isEditor || (afterActivityStart && (alreadyClaimed || eligible));

  console.log("PGY mystery box entry local lines", {
    orderId,
    orderName,
    orderProcessedAt,
    configLoading: config.loading,
    activityStartBeijing: config.activityStartBeijing,
    afterActivityStart,
    total: orderTotal.amount,
    currency: orderTotal.currencyCode,
    minOrderAmount: config.minOrderAmount,
    alreadyClaimed,
    lines: orderLines.map(summarizeLine),
  });

  if (config.loading || !show) return null;

  const message = alreadyClaimed
    ? getClaimedMessage()
    : eligible
      ? getQualifiedMessage()
      : getMinimumMessage(config.minOrderAmount);

  return (
    <s-box background="base" border="base" borderRadius="large" padding="base">
      <s-stack gap="small">
        <s-heading>
          {alreadyClaimed ? "Lucky Box Opened!" : "PGYTECH Exclusive Mystery Box"}
        </s-heading>
        <s-text>{message}</s-text>
        {afterActivityStart && !alreadyClaimed && eligible ? (
          <s-button href={buildMysteryBoxUrl(storefrontOrigin)} variant="primary">
            Open Mystery Box
          </s-button>
        ) : null}
      </s-stack>
    </s-box>
  );
}
/* eslint-enable react/prop-types */

function isAfterActivityStart(processedAt, activityStartBeijing) {
  if (!activityStartBeijing) return false;
  const processedTime = processedAt ? new Date(processedAt).getTime() : Date.now();
  const startTime = new Date(activityStartBeijing).getTime();
  return Number.isFinite(processedTime) && processedTime >= startTime;
}

function hasClaimedPrizeLine(lines) {
  return lines.some(isFreeCustomDiscountLine);
}

function isFreeCustomDiscountLine(line) {
  const total = Number(line?.cost?.totalAmount?.amount ?? NaN);
  if (total !== 0) return false;

  return (line?.discountAllocations || []).some((discount) => {
    const discountedAmount = Number(discount?.discountedAmount?.amount || 0);
    return discount?.type === "custom" && discountedAmount > 0;
  });
}

function lineSearchText(line) {
  const merchandise = line?.merchandise || {};
  const product = merchandise?.product || {};
  return [
    line?.id,
    merchandise?.title,
    merchandise?.subtitle,
    merchandise?.sku,
    merchandise?.displayName,
    product?.title,
    ...(merchandise?.selectedOptions || []).flatMap((option) => [
      option?.name,
      option?.value,
    ]),
    ...(line?.attributes || []).flatMap((attribute) => [
      attribute?.key,
      attribute?.value,
    ]),
    ...(line?.discountAllocations || []).flatMap((discount) => [
      discount?.type,
      discount?.title,
      discount?.code,
      discount?.discountApplication?.title,
      discount?.discountApplication?.type,
    ]),
  ]
    .filter(Boolean)
    .join(" ");
}

function summarizeLine(line) {
  const merchandise = line?.merchandise || {};
  return {
    id: line?.id,
    title: merchandise?.title || merchandise?.product?.title || "",
    sku: merchandise?.sku || "",
    total: line?.cost?.totalAmount?.amount,
    attributes: line?.attributes || [],
    discounts: line?.discountAllocations || [],
    matchedText: lineSearchText(line),
  };
}

export function readSignal(signal) {
  return signal?.current ?? signal?.value ?? signal;
}

export function readTotalAmount() {
  const total = readSignal(shopify.cost?.totalAmount);
  return {
    amount: Number(total?.amount || 0),
    currencyCode: total?.currencyCode || "",
  };
}

export function readOrderLines() {
  const lines = readSignal(shopify.lines);
  return Array.isArray(lines) ? lines : [];
}
