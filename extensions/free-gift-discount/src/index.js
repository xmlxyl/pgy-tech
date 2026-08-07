const FREE_GIFT_ATTRIBUTE_VALUE = "free";
const THRESHOLD = 99;
const DEFAULT_COMBO_DISCOUNT_RULES = [
  {
    message: "SUMMER15",
    percentage: 15,
    required: [
      { type: "product", id: "8590470447276" },
      { type: "product", id: "8590468645036" },
    ],
    targets: [],
  },
  {
    message: "SUMMER15",
    percentage: 15,
    required: [
      { type: "product", id: "8590468743340" },
      { type: "product", id: "8590471790764" },
    ],
    targets: [],
  },
  {
    message: "SUMMER15",
    percentage: 15,
    required: [
      { type: "product", id: "8590467956908" },
      { type: "product", id: "8590467891372" },
    ],
    targets: [],
  },
];

/**
 * @param {import("../generated/api").CartLinesDiscountsGenerateRunInput} input
 * @returns {import("../generated/api").CartLinesDiscountsGenerateRunResult}
 */
export function cartLinesDiscountsGenerateRun(input) {
  const lines = input.cart.lines;
  const freeGiftVariantId = input.cart.freeGiftVariantId?.value;
  const candidates = [];
  const qualifyingSubtotal = lines
    .filter((line) => !isFreeGift(line, freeGiftVariantId))
    .reduce((sum, line) => {
      return sum + Number(line.cost.subtotalAmount.amount || 0);
    }, 0);

  if (qualifyingSubtotal >= THRESHOLD) {
    candidates.push(...buildFreeGiftCandidates(lines, freeGiftVariantId));
  }

  if (isComboDiscountEnabled(input.cart.comboDiscountEnabled?.value)) {
    candidates.push(
      ...buildComboDiscountCandidates(lines, [
        ...DEFAULT_COMBO_DISCOUNT_RULES,
        ...parseComboDiscountRules(input.cart.comboDiscounts?.value),
      ]),
    );
  }

  if (candidates.length === 0) {
    return noDiscounts();
  }

  return {
    operations: [
      {
        productDiscountsAdd: {
          candidates,
          selectionStrategy: "ALL",
        },
      },
    ],
  };
}

function buildFreeGiftCandidates(lines, freeGiftVariantId) {
  return lines
    .filter((line) => isFreeGift(line, freeGiftVariantId))
    .map((line) => ({
      message: "FREE",
      targets: [
        {
          cartLine: {
            id: line.id,
          },
        },
      ],
      value: {
        percentage: {
          value: 100,
        },
      },
    }));
}

function isComboDiscountEnabled(value) {
  return String(value || "").toLowerCase() !== "false";
}

function buildComboDiscountCandidates(lines, rules) {
  if (!rules.length) return [];

  const remainingQuantities = new Map(
    lines.map((line) => [line.id, Math.max(0, Number(line.quantity) || 0)]),
  );
  const candidates = [];

  rules.forEach((rule) => {
    const selectedRequiredLines = selectRequiredLines(
      lines,
      remainingQuantities,
      rule.required,
    );

    if (!selectedRequiredLines) return;

    const targetLines = selectTargetLines(
      lines,
      remainingQuantities,
      rule.targets,
      selectedRequiredLines,
    );

    if (!targetLines.length) return;

    uniqueLines([...selectedRequiredLines, ...targetLines]).forEach((line) =>
      consumeLine(remainingQuantities, line),
    );

    candidates.push({
      message: rule.message,
      targets: targetLines.map((line) => ({
        cartLine: {
          id: line.id,
          quantity: 1,
        },
      })),
      value: {
        percentage: {
          value: rule.percentage,
        },
      },
    });
  });

  return candidates;
}

function selectRequiredLines(lines, remainingQuantities, requiredMatchers) {
  const selected = [];

  for (const matcher of requiredMatchers) {
    const line = lines.find(
      (candidate) =>
        getRemainingQuantity(remainingQuantities, candidate) > 0 &&
        !selected.includes(candidate) &&
        matchesLine(candidate, matcher),
    );

    if (!line) return null;

    selected.push(line);
  }

  return selected;
}

function selectTargetLines(
  lines,
  remainingQuantities,
  targetMatchers,
  fallbackLines,
) {
  if (!targetMatchers.length) return fallbackLines;

  const selected = [];

  for (const matcher of targetMatchers) {
    const line = lines.find(
      (candidate) =>
        getRemainingQuantity(remainingQuantities, candidate) > 0 &&
        !selected.includes(candidate) &&
        matchesLine(candidate, matcher),
    );

    if (line) selected.push(line);
  }

  return selected;
}

function parseComboDiscountRules(value) {
  const rawRules = parseJsonArray(value);

  return rawRules
    .map((rawRule, index) => normalizeComboDiscountRule(rawRule, index))
    .filter(Boolean);
}

function normalizeComboDiscountRule(rawRule, index) {
  if (!rawRule || typeof rawRule !== "object") return null;

  const percentage = normalizePercentage(
    rawRule.percentage ?? rawRule.discountPercentage ?? rawRule.discount,
  );
  const required = [
    ...normalizeMatchers(toArray(rawRule.required)),
    ...normalizeMatchers(
      [
        ...toArray(rawRule.requiredProducts ?? rawRule.requiredProductIds),
        ...toArray(rawRule.products ?? rawRule.productIds),
      ],
      "product",
    ),
    ...normalizeMatchers(
      [
        ...toArray(rawRule.requiredVariants ?? rawRule.requiredVariantIds),
        ...toArray(rawRule.variants ?? rawRule.variantIds),
      ],
      "variant",
    ),
  ];

  if (!percentage || required.length < 2) return null;

  return {
    message: String(rawRule.message || `Combo ${index + 1} ${percentage}% OFF`),
    percentage,
    required,
    targets: [
      ...normalizeMatchers(toArray(rawRule.targets ?? rawRule.target)),
      ...normalizeMatchers(
        toArray(rawRule.targetProducts ?? rawRule.targetProductIds),
        "product",
      ),
      ...normalizeMatchers(
        toArray(rawRule.targetVariants ?? rawRule.targetVariantIds),
        "variant",
      ),
    ],
  };
}

function normalizeMatchers(values, explicitType) {
  return values
    .map((value) => normalizeMatcher(value, explicitType))
    .filter(Boolean);
}

function normalizeMatcher(value, explicitType) {
  if (!value) return null;

  if (typeof value === "string" || typeof value === "number") {
    return matcherFromId(value, explicitType);
  }

  if (typeof value !== "object") return null;

  const productId = value.productId ?? value.product ?? value.id;
  const variantId = value.variantId ?? value.variant;

  if (variantId) return { type: "variant", id: String(variantId) };
  if (productId) return matcherFromId(productId, value.type || explicitType);

  return null;
}

function matcherFromId(value, explicitType) {
  const id = String(value).trim();

  if (!id) return null;

  if (explicitType === "variant" || id.includes("/ProductVariant/")) {
    return { type: "variant", id };
  }

  return { type: "product", id };
}

function parseJsonArray(value) {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);

    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function normalizePercentage(value) {
  const percentage = Number(value);

  if (!Number.isFinite(percentage) || percentage <= 0) return null;

  return Math.min(100, percentage);
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];

  return [value];
}

function matchesLine(line, matcher) {
  if (matcher.type === "variant") {
    return matchesVariantId(line.merchandise, matcher.id);
  }

  return matchesProductId(line.merchandise, matcher.id);
}

function consumeLine(remainingQuantities, line) {
  remainingQuantities.set(
    line.id,
    Math.max(0, getRemainingQuantity(remainingQuantities, line) - 1),
  );
}

function getRemainingQuantity(remainingQuantities, line) {
  return remainingQuantities.get(line.id) || 0;
}

function uniqueLines(lines) {
  return lines.filter((line, index) => lines.indexOf(line) === index);
}

function isFreeGift(line, freeGiftVariantId) {
  return (
    line.freeGift?.value === FREE_GIFT_ATTRIBUTE_VALUE ||
    matchesVariantId(line.merchandise, freeGiftVariantId)
  );
}

function matchesVariantId(merchandise, variantId) {
  if (!variantId || merchandise?.__typename !== "ProductVariant") {
    return false;
  }

  return (
    merchandise.id === variantId ||
    merchandise.id.endsWith(`/ProductVariant/${variantId}`)
  );
}

function matchesProductId(merchandise, productId) {
  if (!productId || merchandise?.__typename !== "ProductVariant") {
    return false;
  }

  const merchandiseProductId = merchandise.product?.id;

  return (
    merchandiseProductId === productId ||
    merchandiseProductId?.endsWith(`/Product/${productId}`)
  );
}

function noDiscounts() {
  return { operations: [] };
}
