"use client"

  import { useState } from "react"
  import MessageBubble from "./MessageBubble"
  import ChatInput from "./ChatInput"

  export default function ChatPanel() {
    const [messages, setMessages] = useState<{role: string, content: string}[]>([])

    async function handleSend(message: string) {
      const updated = [...messages, { role: "user", content: message }]
      setMessages(updated)

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