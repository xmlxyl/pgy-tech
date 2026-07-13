const FREE_GIFT_ATTRIBUTE_VALUE = "free";
const THRESHOLD = 99;

/**
 * @param {import("../generated/api").CartLinesDiscountsGenerateRunInput} input
 * @returns {import("../generated/api").CartLinesDiscountsGenerateRunResult}
 */
export function cartLinesDiscountsGenerateRun(input) {
  const lines = input.cart.lines;
  const qualifyingSubtotal = lines
    .filter((line) => !isFreeGift(line))
    .reduce((sum, line) => {
      return sum + Number(line.cost.subtotalAmount.amount || 0);
    }, 0);

  if (qualifyingSubtotal < THRESHOLD) {
    return noDiscounts();
  }

  const candidates = lines.filter(isFreeGift).map((line) => ({
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

function isFreeGift(line) {
  return line.freeGift?.value === FREE_GIFT_ATTRIBUTE_VALUE;
}

function noDiscounts() {
  return { operations: [] };
}
