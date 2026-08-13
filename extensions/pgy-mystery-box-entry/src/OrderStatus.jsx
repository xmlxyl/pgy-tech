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
      const order = readSignal(shopify.order);
      return order?.id || "";
    },
    getOrderName: () => {
      const order = readSignal(shopify.order);
      return order?.name || "";
    },
    getOrderProcessedAt: () => {
      const order = readSignal(shopify.order);
      return order?.processedAt || "";
    },
    getOrderTotal: readTotalAmount,
    getOrderLines: readOrderLines,
  });
}
