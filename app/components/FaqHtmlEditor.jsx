import { useEffect, useState } from "react";
import "./FaqHtmlEditor.css";

/**
 * 客户端 HTML 富文本（Quill），用于 FAQ 答案；SSR 阶段回退为 textarea。
 * @param {{ label: string; value: string; onChange: (html: string) => void; placeholder?: string }} props
 */
export function FaqHtmlEditor({ label, value, onChange, placeholder }) {
  const [QuillComp, setQuillComp] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await import("react-quill/dist/quill.snow.css");
      const mod = await import("react-quill");
      if (!cancelled) {
        setQuillComp(() => mod.default);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!QuillComp) {
    return (
      <s-text-area
        label={label}
        rows={6}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        autocomplete="off"
      />
    );
  }

  return (
    <div className="faq-html-editor">
      <div style={{ marginBottom: "0.375rem", fontWeight: 600, fontSize: "0.8125rem" }}>
        {label}
      </div>
      <QuillComp
        theme="snow"
        value={value || ""}
        onChange={(html) => onChange(html)}
        placeholder={placeholder}
        modules={{
          toolbar: [
            [{ header: [1, 2, 3, false] }],
            ["bold", "italic", "underline", "strike"],
            [{ list: "ordered" }, { list: "bullet" }],
            [{ indent: "-1" }, { indent: "+1" }],
            ["link", "image"],
            ["blockquote", "code-block"],
            ["clean"],
          ],
        }}
        formats={[
          "header",
          "bold",
          "italic",
          "underline",
          "strike",
          "list",
          "bullet",
          "indent",
          "link",
          "image",
          "blockquote",
          "code-block",
        ]}
      />
    </div>
  );
}
