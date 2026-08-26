"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function ChatMarkdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children: value }) => (
          <p className="mb-3 leading-7 last:mb-0">{value}</p>
        ),
        ul: ({ children: value }) => (
          <ul className="mb-3 list-disc space-y-1 pl-5">{value}</ul>
        ),
        ol: ({ children: value }) => (
          <ol className="mb-3 list-decimal space-y-1 pl-5">{value}</ol>
        ),
        table: ({ children: value }) => (
          <div className="my-4 overflow-x-auto rounded-xl border border-[var(--border)]">
            <table className="w-full border-collapse text-sm">{value}</table>
          </div>
        ),
        th: ({ children: value }) => (
          <th className="border-b border-[var(--border)] bg-[var(--quiet)] px-3 py-2 text-left">
            {value}
          </th>
        ),
        td: ({ children: value }) => (
          <td className="border-b border-[var(--border)] px-3 py-2">{value}</td>
        )
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
