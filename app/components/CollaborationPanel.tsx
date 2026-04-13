"use client"

import { useState, useEffect, useRef } from "react"
import MessageBubble from "./MessageBubble"
import { personalities, buildCollabSystemPrompt } from "../lib/personalities"

const INTERRUPT_PREFIX = "[interrupt] "

/** Strip <think>...</think> blocks — some models emit these even with think:false */
function stripThinkBlocks(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim()
}

/** Strip stage directions — parenthetical action/emotion notes emitted by smaller models
 *  despite the "no stage directions" instruction in the system prompt. */
function stripStageDirections(text: string): string {
  // Remove leading parenthetical blocks: "(A measured, thoughtful response...)\n\n"
  return text.replace(/^\s*\([^)]{0,200}\)\s*\n*/g, "").trim()
}

// Convergence detection — if the last response signals agreement/termination,
// skip the next turn entirely rather than paying for an "agreed, nothing to add" call.
// Two triggers: (1) response under 60 chars with no question, (2) explicit convergence phrases.
const CONVERGENCE_PHRASES = [
  "nothing to add", "nothing more to add", "nothing further",
  "i have nothing more",
]

function isConvergence(text: string): boolean {
  const t = text.trim().toLowerCase()
  if (!t) return false
  return CONVERGENCE_PHRASES.some(p => t.includes(p))
}

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
  const [thinkingPersonality, setThinkingPersonality] = useState<string | null>(null)
  const [maxRounds, setMaxRounds] = useState(3)
  const [input, setInput] = useState("")
  const abortRef = useRef<AbortController | null>(null)
  const messagesRef = useRef<CollabMessage[]>([])
  const runningRef = useRef(false)
  const queuedRef = useRef<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, thinkingPersonality])

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
            const mapped: CollabMessage[] = msgs.map((m: any) => {
              const isInterrupt = m.role === "user" && m.content?.startsWith(INTERRUPT_PREFIX)
              return {
                role: m.role as "user" | "assistant",
                content: isInterrupt ? m.content.slice(INTERRUPT_PREFIX.length) : m.content,
                personality: m.personality,
                id: m.id,
                isInterrupt,
              }
            })
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
      totalRounds,
      localStorage.getItem("ensemble-user-name") || undefined,
    )

    // Build API messages — last 20, convert other-personality assistant turns to context notes
    const recent = messagesRef.current.slice(-20).filter(m => !m.isInterrupt)
    const apiMessages = recent.map(m => {
      if (m.role === "assistant" && m.personality && m.personality !== personalityId) {
        const otherName = personalities[m.personality]?.name || m.personality
        return { role: "user" as const, content: `[${otherName} said: "${m.content}"] — this is from your AI counterpart, not from Carl.` }
      }
      return { role: m.role as "user" | "assistant", content: m.content }
    })

    const counterpart = personalityId === "aimee" ? "arthur" : "aimee"

    // Inject identity context into the last user message — lands in the high-attention zone
    // right next to the actual question, not buried in the system prompt under memory blocks.
    const storedUserName = localStorage.getItem("ensemble-user-name") || ""
    const humanLabel = storedUserName || "the user"
    const lastUserIdx = apiMessages.reduce((acc: number, m: {role: string}, i: number) => m.role === "user" ? i : acc, -1)
    if (lastUserIdx !== -1) {
      const charName = personalities[personalityId]?.name ?? personalityId
      const counterpartPName = personalities[counterpart]?.name ?? counterpart
      const identityPrefix = `[You are ${charName}. Human: ${humanLabel}. Counterpart AI: ${counterpartPName}.] `
      apiMessages[lastUserIdx] = {
        ...apiMessages[lastUserIdx],
        content: identityPrefix + apiMessages[lastUserIdx].content,
      }
    }

    abortRef.current = new AbortController()
    setThinkingPersonality(personalityId)

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: apiMessages, systemPrompt, sessionId: sid, personality: personalityId, collabCounterpart: counterpart }),
      signal: abortRef.current.signal,
    })

    setThinkingPersonality(null)

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
            updateLastAssistantMessage(stripStageDirections(stripThinkBlocks(aiMessage)), personalityId)
          }
        } catch {}
      }
    }
    // Flush any content left in buffer (final chunk may lack trailing newline)
    if (buffer.trim()) {
      try {
        const data = JSON.parse(buffer.trim())
        if (data.message?.content) {
          aiMessage += data.message.content
          updateLastAssistantMessage(stripThinkBlocks(aiMessage), personalityId)
        }
      } catch {}
    }

    const cleanMessage = stripStageDirections(stripThinkBlocks(aiMessage))
    if (cleanMessage) {
      const saved = await fetch(`/api/sessions/${sid}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "assistant", content: cleanMessage, personality: personalityId }),
      }).then(r => r.json())
      if (saved?.id) patchLastMessageId(personalityId, saved.id)
    }

    return cleanMessage
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

        let response = ""
        try {
          response = await streamTurn(personalityId, round, totalRounds)
        } catch (e: any) {
          if (e.name === "AbortError") {
            runningRef.current = false
            break
          }
        }

        if (!runningRef.current) break

        // Early termination — if the character signaled convergence, stop the loop
        // before paying for the next turn's "agreed, nothing to add" call.
        if (response && isConvergence(response)) {
          runningRef.current = false
          break
        }

        // Check for queued user injection at turn boundary
        const queued = queuedRef.current
        if (queued) {
          queuedRef.current = null

          // Show as a visible, labeled interrupt in the timeline
          appendMessage({ role: "user", content: queued, isInterrupt: true })
          await fetch(`/api/sessions/${sid}/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // Prefix with sentinel so interrupt styling survives session reload
            body: JSON.stringify({ role: "user", content: `${INTERRUPT_PREFIX}${queued}`, personality: "user" }),
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
          <span
            className="text-xs text-zinc-500 border border-zinc-700 px-2 py-0.5 rounded"
            title="Voice playback is paused in Collab mode — the back-and-forth is too fast to follow by ear."
          >
            Voice off
          </span>
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
        {thinkingPersonality && (
          <div>
            <div className={`text-xs mb-1 ml-1 font-medium ${thinkingPersonality === "aimee" ? "text-purple-400" : "text-blue-400"}`}>
              {personalities[thinkingPersonality]?.name ?? thinkingPersonality}
            </div>
            <div className="flex justify-start">
              <div className="rounded p-3 bg-zinc-700">
                <span className="inline-flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                </span>
              </div>
            </div>
          </div>
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
