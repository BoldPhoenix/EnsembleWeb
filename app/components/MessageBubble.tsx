"use client"

import { useState } from "react"
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

export default function MessageBubble({ role, content, personality, messageId, sessionId }: {
  role: string
  content: string
  personality?: string
  messageId?: string
  sessionId?: string | null
}) {
  const [reported, setReported] = useState(false)

  function reportSycophancy() {
    if (!messageId || !sessionId || reported) return
    setReported(true)
    fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId, sessionId, feedbackType: "sycophancy" }),
    }).catch(() => setReported(false))
  }

  return (
    <div className={`flex ${role === "user" ? "justify-end" : "justify-start"}`}>
      <div className={`group rounded p-3 max-w-2xl prose prose-invert prose-sm ${role === "user" ? "bg-blue-600 text-white" : "bg-zinc-700 text-cyan-200"}`}>
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
        {role === "assistant" && messageId && (
          <div className="mt-1 flex justify-end">
            <button
              onClick={reportSycophancy}
              disabled={reported}
              className={`text-xs px-1.5 py-0.5 rounded transition-all opacity-0 group-hover:opacity-100 ${
                reported
                  ? "opacity-100 bg-yellow-900/30 text-yellow-600 cursor-default"
                  : "bg-zinc-600/50 text-zinc-500 hover:bg-yellow-900/30 hover:text-yellow-400"
              }`}
              title={reported ? "Flagged" : "Flag as sycophantic — they agreed without pushing back"}
            >
              {reported ? "✓ flagged" : "⚑"}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
