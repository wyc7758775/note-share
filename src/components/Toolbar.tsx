import { useEffect, useRef, useState } from "react";
import type { Editor as TipTapEditor } from "@tiptap/react";
import { I } from "./icons";

interface Props {
  editor: TipTapEditor;
  onInsertExcalidraw: () => void;
  onInsertImageFile: (file: File) => void;
}

export default function Toolbar({ editor, onInsertExcalidraw, onInsertImageFile }: Props) {
  const [, force] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const cb = () => force((v) => v + 1);
    editor.on("transaction", cb);
    return () => {
      editor.off("transaction", cb);
    };
  }, [editor]);

  const setLink = () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("链接地址（留空取消链接）", prev ?? "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  return (
    <div className="flex flex-wrap items-center gap-0.5 text-stone-500">
      <TBtn title="撤销" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}>
        ↺
      </TBtn>
      <TBtn title="重做" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}>
        ↻
      </TBtn>
      <Sep />
      <TBtn title="标题 1" active={editor.isActive("heading", { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>
        H1
      </TBtn>
      <TBtn title="标题 2" active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
        H2
      </TBtn>
      <TBtn title="标题 3" active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
        H3
      </TBtn>
      <Sep />
      <TBtn title="加粗" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
        <b>B</b>
      </TBtn>
      <TBtn title="斜体" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <i>I</i>
      </TBtn>
      <TBtn title="删除线" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}>
        <s>S</s>
      </TBtn>
      <TBtn title="行内代码" active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()}>
        {"</>"}
      </TBtn>
      <TBtn title="链接" active={editor.isActive("link")} onClick={setLink}>
        🔗
      </TBtn>
      <Sep />
      <TBtn title="无序列表" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        •
      </TBtn>
      <TBtn title="有序列表" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        1.
      </TBtn>
      <TBtn title="待办清单" active={editor.isActive("taskList")} onClick={() => editor.chain().focus().toggleTaskList().run()}>
        ☑
      </TBtn>
      <TBtn title="引用" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
        ❝
      </TBtn>
      <TBtn title="代码块" active={editor.isActive("codeBlock")} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
        {"{ }"}
      </TBtn>
      <TBtn title="分隔线" onClick={() => editor.chain().focus().setHorizontalRule().run()}>
        ―
      </TBtn>
      <Sep />
      <TBtn title="插入图片（也可直接拖进来）" onClick={() => fileRef.current?.click()}>
        {I.image}
      </TBtn>
      <TBtn title="插入 Excalidraw 画板" onClick={onInsertExcalidraw}>
        {I.pen}
      </TBtn>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onInsertImageFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function TBtn({
  title,
  onClick,
  active,
  disabled,
  children,
}: {
  title: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-[13px] transition-colors ${
        active
          ? "bg-amber-100 text-amber-800"
          : "text-stone-500 hover:bg-stone-200/70 hover:text-stone-800"
      } disabled:opacity-30`}
    >
      {children}
    </button>
  );
}

const Sep = () => <span className="mx-1 h-4 w-px bg-stone-300" />;
