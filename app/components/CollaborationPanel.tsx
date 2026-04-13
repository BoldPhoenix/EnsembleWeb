"use client"

import { useState, useEffect, useRef } from "react"
import MessageBubble from "./MessageBubble"
import { personalities, buildCollabSystemPrompt } from "../lib/personalities"

interface CollabMessage {
  role: "user" | "assistant"
  content: string
  personality?: string
  id?: string
  isInterrupt?: boolean
}

export default function CollaborationPanel() {
  const [messages, setMessages] = useState<CollabMessage[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [currentRound, setCurrentRound] = useState(0)
  const [maxRounds, setMaxRounds] = useState(3)
  const [input, setInput] = useState("")
  const abortRef = useRef<AbortController | null>(null)
  const messagesRef = useRef<CollabMessage[]>([])
  const runningRef = useRef(false)
  const queuedRef = useRef<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  useEffect(() => {
    async function init() {
      const rounds = parseInt(localStorage.getItem("ensemble-collab-rounds") || "3", 10)
      setMaxRounds(isNaN(rounds) ? 3 : Math.max(1, Math.min(99, rounds)))

      const savedId = localStorage.getItem("ensemble-session-id")
      if (savedId) {
        const res = await fetch(`/api/sessions/${savedId}/messages`)
        if (res.ok) {
          const msgs = await res.json()
          if (msgs.length > 0) {
            const mapped: CollabMessage[] = msgs.map((m: any) => ({
              role: m.role as "user" | "assistant",
              content: m.content,
              personality: m.personality,
              id: m.id,
            }))
            messagesRef.current = mapped
            setMessages(mapped)
            setSessionId(savedId)
            sessionIdRef.current = savedId
            return
          }
        }
      }
      const res = await fetch("/api/sessions", { method: "POST" })
      const session = await res.json()
      setSessionId(session.id)
      sessionIdRef.current = session.id
      localStorage.setItem("ensemble-session-id", session.id)
    }
    init()
  }, [])

  function appendMessage(msg: CollabMessage) {
    const updated = [...messagesRef.current, msg]
    messagesRef.current = updated
    setMessages([...updated])
  }

  function updateLastAssistantMessage(content: string, personalityId: string) {
    const updated = [...messagesRef.current]
    const lastIdx = updated.length - 1
    if (lastIdx >= 0 && updated[lastIdx].role === "assistant" && updated[lastIdx].personality === personalityId) {
      updated[lastIdx] = { ...updated[lastIdx], content }
      messagesRef.current = updated
      setMessages([...updated])
    }
  }

  function patchLastMessageId(personalityId: string, id: string) {
    const updated = [...messagesRef.current]
    const lastIdx = updated.length - 1
    if (lastIdx >= 0 && updated[lastIdx].role === "assistant" && updated[lastIdx].personality === personalityId) {
      updated[lastIdx] = { ...updated[lastIdx], id }
      messagesRef.current = updated
      setMessages([...updated])
    }
  }

  async function streamTurn(personalityId: string, round: number, totalRounds: number): Promise<string> {
    const sid = sessionIdRef.current
    if (!sid) return ""

    const systemPrompt = buildCollabSystemPrompt(
      personalityId,
      localStorage.getItem(`ensemble-desc-${personalityId}`) || undefined,
      round,
      totalRounds
    )

    // Build API messages — last 20, convert other-personality assistant turns to context notes
    const recent = messagesRef.current.slice(-20).filter(m => !m.isInterrupt)
    const apiMessages = recent.map(m => {
      if (m.role === "assistant" && m.personality && m.personality !== personalityId) {
        const otherName = personalities[m.personality]?.name || m.personality
        return { role: "user" as const, content: `(Context: ${otherName} said: "${m.content}")` }
      }
      return { role: m.role as "user" | "assistant", content: m.content }
    })

    abortRef.current = new AbortController()

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: apiMessages, systemPrompt, sessionId: sid, personality: personalityId }),
      signal: abortRef.current.signal,
    })

    if (!response.body) return ""

    // Placeholder for streaming
    appendMessage({ role: "assistant", content: "", personality: personalityId })

    const reader = response.body.getReader()
    const decoder = new TextDecoder("utf-8", { fatal: false })
    let aiMessage = ""
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
            updateLastAssistantMessage(aiMessage, personalityId)
          }
        } catch {}
      }
    }

    if (aiMessage) {
      const saved = await fetch(`/api/sessions/${sid}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "assistant", content: aiMessage, personality: personalityId }),
      }).then(r => r.json())
      if (saved?.id) patchLastMessageId(personalityId, saved.id)
    }

    return aiMessage
  }

  async function runCollaboration(userMessage: string) {
    const sid = sessionIdRef.current
    if (!sid) return

    runningRef.current = true
    setIsRunning(true)
    queuedRef.current = null

    const rounds = parseInt(localStorage.getItem("ensemble-collab-rounds") || "3", 10)
    const totalRounds = isNaN(rounds) ? 3 : Math.max(1, Math.min(99, rounds))
    setMaxRounds(totalRounds)

    // Save and display user message
    appendMessage({ role: "user", content: userMessage })
    await fetch(`/api/sessions/${sid}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "user", content: userMessage, personality: "user" }),
    })

    const order = ["aimee", "arthur"]
    let round = 1

    while (round <= totalRounds && runningRef.current) {
      setCurrentRound(round)

      for (const personalityId of order) {
        if (!runningRef.current) break

        try {
          await streamTurn(personalityId, round, totalRounds)
        } catch (e: any) {
          if (e.name === "AbortError") {
            runningRef.current = false
            break
          }
        }

        if (!runningRef.current) break

        // Check for queued user injection at turn boundary
        const queued = queuedRef.current
        if (queued) {
          queuedRef.current = null

          // Show as a visible, labeled interrupt in the timeline
          appendMessage({ role: "user", content: queued, isInterrupt: true })
          await fetch(`/api/sessions/${sid}/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role: "user", content: queued, personality: "user" }),
          })

          // Reset round counter — user injected new context, restart from round 1
          round = 0
          break
        }
      }

      round++
    }

    runningRef.current = false
    setIsRunning(false)
    setCurrentRound(0)
  }

  function handleSend() {
    const msg = input.trim()
    if (!msg) return
    setInput("")
    if (runningRef.current) {
      queuedRef.current = msg
    } else {
      runCollaboration(msg)
    }
  }

  function handleStop() {
    abortRef.current?.abort()
    runningRef.current = false
    queuedRef.current = null
    setIsRunning(false)
    setCurrentRound(0)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Panel header — character indicators + round tracker + stop */}
      <div className="flex items-center justify-between px-4 py-2 bg-zinc-800 border-b border-zinc-700 text-sm">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5 text-zinc-300">
            <span className="inline-block w-2 h-2 rounded-full bg-purple-400" />
            Aimee
          </span>
          <span className="text-zinc-600">↔</span>
          <span className="flex items-center gap-1.5 text-zinc-300">
            <span className="inline-block w-2 h-2 rounded-full bg-blue-400" />
            Arthur
          </span>
        </div>
        <div className="flex items-center gap-3">
          {isRunning && currentRound > 0 && (
            <span className="text-xs text-zinc-400">
              Round {currentRound} of {maxRounds}
            </span>
          )}
          {isRunning && (
            <button
              onClick={handleStop}
              className="text-xs bg-red-700 hover:bg-red-600 text-white px-3 py-1 rounded transition"
            >
              Stop
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-zinc-600 text-sm">
            Start a conversation — Aimee and Arthur will discuss it together.
          </div>
        )}
        {messages.map((m, i) =>
          m.isInterrupt ? (
            <div key={i} className="flex justify-center py-1">
              <span className="text-xs text-amber-400 bg-zinc-800/80 px-3 py-1 rounded-full border border-amber-800">
                You stepped in: {m.content}
              </span>
            </div>
          ) : (
            <div key={i}>
              {m.role === "assistant" && m.personality && (
                <div className={`text-xs mb-1 ml-1 font-medium ${m.personality === "aimee" ? "text-purple-400" : "text-blue-400"}`}>
                  {personalities[m.personality]?.name ?? m.personality}
                </div>
              )}
              <MessageBubble
                role={m.role}
                content={m.content}
                personality={m.personality}
                messageId={m.id}
                sessionId={sessionId}
              />
            </div>
          )
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-zinc-700">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            placeholder={isRunning ? "Type to inject context at the next turn boundary..." : "Start a conversation..."}
            rows={1}
            className="flex-1 rounded bg-zinc-800 p-2 text-white resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={handleSend}
            className={`rounded px-4 py-2 text-white transition ${isRunning ? "bg-amber-700 hover:bg-amber-600" : "bg-blue-600 hover:bg-blue-500"}`}
          >
            {isRunning ? "Inject" : "Send"}
          </button>
        </div>
        {isRunning && (
          <p className="text-xs text-zinc-500 mt-1">Your message will appear after the current turn finishes.</p>
        )}
      </div>
    </div>
  )
}
