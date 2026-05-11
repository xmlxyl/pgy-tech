export default function Index() {
  return (
    <s-page heading="PGY Tech App">
      <s-section heading="PGY Tech management App">
        <div style={{ marginBlockEnd: "1.5rem" }}>
        <s-text>管理功能（陆续迭代）：</s-text>
        </div>
        <s-stack direction="inline" gap="base">
        <s-link href="/app/faq">FAQ管理</s-link>
        </s-stack>
      </s-section>
    </s-page>
  );
}
