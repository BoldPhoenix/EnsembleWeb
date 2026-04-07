"use client"

  import { useState, useEffect } from "react"
  import MessageBubble from "./MessageBubble"
  import ChatInput from "./ChatInput"

  export default function ChatPanel() {
    const [messages, setMessages] = useState<{role: string, content: string}[]>([])
    const [sessionId, setSessionId] = useState<string | null>(null)

    useEffect(() => {
      async function createSession() {
        const res = await fetch("/api/sessions", { method: "POST" })
        const session = await res.json()
        setSessionId(session.id)
      }
      createSession()
    }, [])

    async function handleSend(message: string) {
      if (!sessionId) return

      const updated = [...messages, { role: "user", content: message }]
      setMessages(updated)

      await fetch(`/api/sessions/${sessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "user", content: message }),
      })

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: updated }),
      })

      if (!response.body) return

      const reader = response.body.getReader()
      const decoder = new TextDecoder("utf-8", { fatal: false })
      let aiMessage = ""

      setMessages([...updated, { role: "assistant", content: "" }])

      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() || ""

        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const data = JSON.parse(line)
            if (data.message?.content) {
              aiMessage += data.message.content
              setMessages([...updated, { role: "assistant", content: aiMessage }])
            }
          } catch {
            // incomplete JSON, skip
          }
        }
      }

      await fetch(`/api/sessions/${sessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "assistant", content: aiMessage }),
      })
    }

    return (
      <div className="flex flex-col flex-1 p-4">
        <div className="flex-1 flex flex-col overflow-y-auto space-y-2">
          {messages.map((msg, i) => (
            <MessageBubble key={i} role={msg.role} content={msg.content} />
          ))}
        </div>
        <ChatInput onSend={handleSend} />
      </div>
    )
  }