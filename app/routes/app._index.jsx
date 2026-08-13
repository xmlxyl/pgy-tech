export default function Index() {
  return (
    <s-page heading="PGY Tech App">
      <s-section heading="PGY Tech management app">
        <div style={{ marginBlockEnd: "1.5rem" }}>
          <s-text>Management features</s-text>
        </div>
        <s-stack gap="small">
          <s-link href="/app/free-gift">Free Gift Discount</s-link>
          <s-link href="/app/mystery-box">Lucky Box Settings</s-link>
          <s-link href="/app/faq">FAQ</s-link>
          <s-link href="/app/email">Email Records</s-link>
          <s-link>Product Specs Management (Coming soon)</s-link>
          <s-link>Product In-the-box Management (Coming soon)</s-link>
        </s-stack>
      </s-section>
    </s-page>
  );
}
