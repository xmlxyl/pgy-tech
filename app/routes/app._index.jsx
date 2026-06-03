export default function Index() {
  return (
    <s-page heading="PGY Tech App">
      <s-section heading="PGY Tech management App">
        <div style={{ marginBlockEnd: "1.5rem" }}>
        <s-text>管理功能（陆续迭代）：</s-text>
        </div>
        <s-stack gap="small">
          <s-link href="/app/faq">FAQ管理</s-link>
          <s-link href="/app/email">邮箱收集记录</s-link>
          <s-link>Product Specs管理(开发中……)</s-link>
          <s-link>Product In-the-box管理(开发中……)</s-link>
        </s-stack>
      </s-section>
    </s-page>
  );
}
