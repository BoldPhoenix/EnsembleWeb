"use client"

import ReactMarkdown from "react-markdown"

function CodeBlock({ children, className }: { children: React.ReactNode, className?: string }) {
  const text = String(children).replace(/\n$/, "")

  function copyCode() {
    navigator.clipboard.writeText(text)
  }

  return (
    <div className="relative group">
      <button
        onClick={copyCode}
        className="absolute right-2 top-2 rounded bg-zinc-600 px-2 py-1 text-xs text-zinc-300 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        Copy
      </button>
      <pre className={className}>
        <code>{children}</code>
      </pre>
    </div>
  )
}

export default function MessageBubble({ role, content, personality }: { role: string, content: string, personality?: string }) {
  return (
    <div className={`flex ${role === "user" ? "justify-end" : "justify-start"}`}>
      <div className={`rounded p-3 max-w-2xl prose prose-invert prose-sm ${role === "user" ? "bg-blue-600 text-white" : "bg-zinc-700 text-cyan-200"}`}>
        {role === "user" ? content : (
          <ReactMarkdown
            components={{
              pre: ({ children }) => <>{children}</>,
              code: ({ children, className }) => {
                const isBlock = className?.includes("language-")
                if (isBlock) {
                  return <CodeBlock className={className}>{children}</CodeBlock>
                }
                return <code className="bg-zinc-600 px-1 rounded text-sm">{children}</code>
              },
            }}
          >
            {content}
          </ReactMarkdown>
        )}
      </div>
    </div>
  )
}
