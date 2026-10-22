"use client";

import { useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { Bold, Heading, Italic, List, ListOrdered } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { PlaceholderOption } from "./automation-step-model";
import { InsertFieldMenu } from "./insert-field-menu";

type EditorMode = "rich" | "markdown";

interface MarkdownEditorProps {
  id: string;
  label: string;
  value: string;
  onChange: (markdown: string) => void;
  insertOptions: PlaceholderOption[];
  placeholder?: string;
}

const TOOLBAR_BUTTON =
  "flex h-7 w-7 items-center justify-center rounded-md text-[#666055] hover:bg-[#f5f3ee] hover:text-[#1c1b19] aria-pressed:bg-wf-primary-light aria-pressed:text-wf-primary";

function RichToolbar({ editor }: { editor: Editor }) {
  const tools = [
    { label: "Bold", icon: Bold, active: editor.isActive("bold"), run: () => editor.chain().focus().toggleBold().run() },
    { label: "Italic", icon: Italic, active: editor.isActive("italic"), run: () => editor.chain().focus().toggleItalic().run() },
    {
      label: "Heading",
      icon: Heading,
      active: editor.isActive("heading"),
      run: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    {
      label: "Bulleted list",
      icon: List,
      active: editor.isActive("bulletList"),
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      label: "Numbered list",
      icon: ListOrdered,
      active: editor.isActive("orderedList"),
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
  ];
  return (
    <div role="toolbar" aria-label="Formatting" className="flex gap-0.5 border-b border-[#e7e3db] px-1.5 py-1">
      {tools.map((tool) => (
        <button
          key={tool.label}
          type="button"
          aria-label={tool.label}
          aria-pressed={tool.active}
          className={TOOLBAR_BUTTON}
          onClick={tool.run}
        >
          <tool.icon size={14} />
        </button>
      ))}
    </div>
  );
}

// The Email step's message editor (ADR-065 §4): rich text by default, with a
// switch to the markdown it is stored as. Both edit the same markdown string,
// which the step renders to HTML when it sends.
export function MarkdownEditor({ id, label, value, onChange, insertOptions, placeholder }: MarkdownEditorProps) {
  const [mode, setMode] = useState<EditorMode>("rich");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editor = useEditor({
    extensions: [StarterKit, Markdown],
    content: value,
    contentType: "markdown",
    // Rendered on the client only: the editor cannot hydrate server markup.
    immediatelyRender: false,
    editorProps: {
      attributes: {
        id,
        "aria-label": label,
        "aria-multiline": "true",
        role: "textbox",
        class: "prose-sm min-h-[140px] px-3 py-2 text-[13px] leading-[1.55] text-[#1c1b19] outline-hidden",
      },
    },
    onUpdate: ({ editor: current }) => onChange(current.getMarkdown()),
  });

  const switchTo = (next: EditorMode) => {
    if (next === mode) return;
    if (next === "rich") editor?.commands.setContent(value, { contentType: "markdown" });
    setMode(next);
  };

  const insert = (token: string) => {
    if (mode === "rich") {
      editor?.chain().focus().insertContent(token).run();
      return;
    }
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? value.length;
    const end = textarea?.selectionEnd ?? value.length;
    onChange(`${value.slice(0, start)}${token}${value.slice(end)}`);
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <Label htmlFor={mode === "markdown" ? `${id}-markdown` : id}>{label}</Label>
        <div className="flex items-center gap-1">
          <InsertFieldMenu fieldLabel={label} options={insertOptions} onInsert={insert} />
          <div role="group" aria-label="Editor mode" className="flex rounded-md border border-[#e7e3db] p-0.5">
            {(["rich", "markdown"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={mode === option}
                onClick={() => switchTo(option)}
                className="rounded px-2 py-0.5 text-[11.5px] text-[#666055] aria-pressed:bg-[#f1efe9] aria-pressed:text-[#1c1b19]"
              >
                {option === "rich" ? "Rich text" : "Markdown"}
              </button>
            ))}
          </div>
        </div>
      </div>
      {mode === "rich" ? (
        <div className="rounded-[9px] border border-[#e7e3db] bg-[#faf9f7] focus-within:border-wf-primary focus-within:bg-white">
          {editor && <RichToolbar editor={editor} />}
          <EditorContent editor={editor} />
        </div>
      ) : (
        <Textarea
          ref={textareaRef}
          id={`${id}-markdown`}
          rows={8}
          className="font-mono"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
        />
      )}
    </div>
  );
}
