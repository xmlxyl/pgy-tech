// node_modules/@shopify/shopify_function/run.ts
function run_default(userfunction) {
  try {
    ShopifyFunction;
  } catch (e) {
    throw new Error(
      "ShopifyFunction is not defined. Please rebuild your function using the latest version of Shopify CLI."
    );
  }
  const input_obj = ShopifyFunction.readInput();
  const output_obj = userfunction(input_obj);
  ShopifyFunction.writeOutput(output_obj);
}

// extensions/free-gift-discount/src/index.js
var FREE_GIFT_ATTRIBUTE_VALUE = "free";
var THRESHOLD = 99;
function cartLinesDiscountsGenerateRun(input) {
  const lines = input.cart.lines;
  const freeGiftVariantId = input.cart.freeGiftVariantId?.value;
  const qualifyingSubtotal = lines.filter((line) => !isFreeGift(line, freeGiftVariantId)).reduce((sum, line) => {
    return sum + Number(line.cost.subtotalAmount.amount || 0);
  }, 0);
  if (qualifyingSubtotal < THRESHOLD) {
    return noDiscounts();
  }
  const candidates = lines.filter((line) => isFreeGift(line, freeGiftVariantId)).map((line) => ({
    message: "FREE",
    targets: [
      {
        cartLine: {
          id: line.id
        }
      }
    ],
    value: {
      percentage: {
        value: 100
      }
    }
  }));
  if (candidates.length === 0) {
    return noDiscounts();
  }
  return {
    operations: [
      {
        productDiscountsAdd: {
          candidates,
          selectionStrategy: "ALL"
        }
      }
    ]
  };
}
function isFreeGift(line, freeGiftVariantId) {
  return line.freeGift?.value === FREE_GIFT_ATTRIBUTE_VALUE || matchesVariantId(line.merchandise, freeGiftVariantId);
}
function matchesVariantId(merchandise, variantId) {
  if (!variantId || merchandise?.__typename !== "ProductVariant") {
    return false;
  }
  return merchandise.id === variantId || merchandise.id.endsWith(`/ProductVariant/${variantId}`);
}
function noDiscounts() {
  return { operations: [] };
}

// <stdin>
function cartLinesDiscountsGenerateRun2() {
  return run_default(cartLinesDiscountsGenerateRun);
}
export {
  cartLinesDiscountsGenerateRun2 as cartLinesDiscountsGenerateRun
};
