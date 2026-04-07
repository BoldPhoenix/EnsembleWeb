"use client"

 import { useState, useEffect, useRef } from "react"
 import MessageBubble from "./MessageBubble"
 import ChatInput from "./ChatInput"
  

    export default function ChatPanel() {
    const [messages, setMessages] = useState<{role: string, content: string}[]>([])
    const [sessionId, setSessionId] = useState<string | null>(null)
    const [isLoading, setIsLoading] = useState(false)
    const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

    useEffect(() => {
      async function createSession() {
        const res = await fetch("/api/sessions", { method: "POST" })
        const session = await res.json()
        setSessionId(session.id)
      }
      createSession()
    }, [])

    async function speakSentence(text: string) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10000)

      const ttsResponse = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      })
      clearTimeout(timeout)

      if (ttsResponse.ok) {
        const audioBlob = await ttsResponse.blob()
        const audioUrl = URL.createObjectURL(audioBlob)
        return new Audio(audioUrl)
      }
    } catch {
      // fallback handled by caller
    }
    return null
  }

    async function handleSend(message: string) {
    if (!sessionId) return
    setIsLoading(true)

    const updated = [...messages, { role: "user", content: message }]
    setMessages(updated)

    try {
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
      let spokenText = ""
      const audioQueue: Array<Promise<HTMLAudioElement | null>> = []

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

              // Check for complete sentences to speak
              const unspoken = aiMessage.slice(spokenText.length)
              const sentenceMatch = unspoken.match(/[^.!?]*[.!?]\s*/g)
              if (sentenceMatch) {
                for (const sentence of sentenceMatch) {
                  spokenText += sentence
                  audioQueue.push(speakSentence(sentence.trim()))
                }
              }
            }
          } catch {
            // incomplete JSON, skip
          }
        }
      }

      // Speak any remaining text that didn't end with punctuation
      const remaining = aiMessage.slice(spokenText.length).trim()
      if (remaining) {
        audioQueue.push(speakSentence(remaining))
      }

      // Save to DB immediately
      await fetch(`/api/sessions/${sessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "assistant", content: aiMessage }),
      })

      // Play audio in background — don't block UI
      const queue = [...audioQueue]
      ;(async () => {
        for (const audioPromise of queue) {
          try {
            const audio = await audioPromise
            if (audio) {
              await new Promise<void>(resolve => {
                audio.onended = () => resolve()
                audio.onerror = () => resolve()
                audio.play().catch(() => resolve())
              })
            }
          } catch {
            // skip failed audio
          }
        }
      })()
      
    } catch (error) {
      console.error("Chat error:", error)
      setMessages(prev => [...prev, {
        role: "assistant",
        content: "Sorry, something went wrong. Please try again."
      }])
    } finally {
      setIsLoading(false)
    }
  }

    return (
      <div className="flex flex-col flex-1 p-4">
        <div className="flex-1 flex flex-col overflow-y-auto space-y-2">
          {messages.map((msg, i) => (
            <MessageBubble key={i} role={msg.role} content={msg.content} />
          ))}
          <div ref={messagesEndRef} />
        </div>
        {isLoading && (
          <div className="text-zinc-400 text-sm animate-pulse">
          Thinking...
          </div>
        )}
        <ChatInput onSend={handleSend} />
      </div>
    )
  }