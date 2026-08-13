/** @jsxImportSource preact */
import {
  readOrderLines,
  readSignal,
  readTotalAmount,
  renderEntry,
} from "./Entry.jsx";

export default function extension() {
  renderEntry({
    getOrderId: () => {
      const confirmation = readSignal(shopify.orderConfirmation);
      return confirmation?.order?.id || "";
    },
    getOrderName: () => {
      const confirmation = readSignal(shopify.orderConfirmation);
      return confirmation?.order?.name || "";
    },
    getOrderProcessedAt: () => new Date().toISOString(),
    getOrderTotal: readTotalAmount,
    getOrderLines: readOrderLines,
  });
}
