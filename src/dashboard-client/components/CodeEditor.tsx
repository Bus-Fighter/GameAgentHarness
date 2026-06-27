import { useEffect, useRef } from "react";
import { EditorView, basicSetup } from "codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { markdown } from "@codemirror/lang-markdown";
import { StreamLanguage } from "@codemirror/language";
import { csharp } from "@codemirror/legacy-modes/mode/clike";
import { python } from "@codemirror/legacy-modes/mode/python";

interface CodeEditorProps {
  path: string;
  content: string;
  editable: boolean;
  onChange: (value: string) => void;
}

function fileExtension(path: string) {
  const i = path.lastIndexOf(".");
  return i > 0 ? path.slice(i + 1).toLowerCase() : "";
}

function languageSupport(ext: string) {
  if (["js", "mjs", "cjs"].includes(ext)) return javascript();
  if (ext === "ts") return javascript({ typescript: true });
  if (ext === "json") return json();
  if (["html", "htm"].includes(ext)) return html();
  if (ext === "css") return css();
  if (ext === "md") return markdown();
  if (ext === "cs") return StreamLanguage.define(csharp);
  if (["gd", "py"].includes(ext)) return StreamLanguage.define(python);
  return [];
}

export function CodeEditor({ path, content, editable, onChange }: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const ext = fileExtension(path);
    const view = new EditorView({
      doc: content,
      extensions: [
        basicSetup,
        oneDark,
        languageSupport(ext),
        EditorView.editable.of(editable),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChange(update.state.doc.toString());
          }
        }),
      ],
      parent: containerRef.current,
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [path, content, editable, onChange]);

  return <div ref={containerRef} className="h-full min-h-[240px]" />;
}
