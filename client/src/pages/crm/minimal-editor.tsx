import { useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { cn } from "@/lib/utils";

export default function MinimalEditor({
  content,
  onSave,
  placeholder = "Adicione uma descrição...",
}: {
  content: string | null;
  onSave: (html: string | null) => void;
  placeholder?: string;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder }),
    ],
    content: content || "",
    onBlur: ({ editor }) => {
      const html = editor.isEmpty ? null : editor.getHTML();
      onSave(html);
    },
    editorProps: {
      attributes: {
        class: "min-h-[80px] text-sm leading-relaxed focus:outline-none px-3 py-2",
      },
    },
  });

  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content || "");
    }
  }, [content]);

  return (
    <div className="border rounded-md mt-1 bg-background focus-within:ring-1 focus-within:ring-ring">
      <div className="flex gap-0.5 p-1 border-b bg-muted/30 rounded-t-md flex-wrap">
        {[
          { label: "B", cmd: () => editor?.chain().focus().toggleBold().run(), active: editor?.isActive("bold"), title: "Negrito" },
          { label: "I", cmd: () => editor?.chain().focus().toggleItalic().run(), active: editor?.isActive("italic"), title: "Itálico" },
          { label: "S̶", cmd: () => editor?.chain().focus().toggleStrike().run(), active: editor?.isActive("strike"), title: "Tachado" },
        ].map(b => (
          <button
            key={b.label}
            type="button"
            onMouseDown={e => { e.preventDefault(); b.cmd(); }}
            className={cn("w-7 h-7 text-xs font-medium rounded hover:bg-muted transition-colors", b.active && "bg-primary/10 text-primary")}
            title={b.title}
          >
            {b.label}
          </button>
        ))}
        <div className="w-px h-5 bg-border mx-0.5 self-center" />
        {[
          { label: "•", cmd: () => editor?.chain().focus().toggleBulletList().run(), active: editor?.isActive("bulletList"), title: "Lista" },
          { label: "1.", cmd: () => editor?.chain().focus().toggleOrderedList().run(), active: editor?.isActive("orderedList"), title: "Lista numerada" },
        ].map(b => (
          <button
            key={b.label}
            type="button"
            onMouseDown={e => { e.preventDefault(); b.cmd(); }}
            className={cn("w-7 h-7 text-xs font-medium rounded hover:bg-muted transition-colors", b.active && "bg-primary/10 text-primary")}
            title={b.title}
          >
            {b.label}
          </button>
        ))}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
