"use client"

import { useState, useEffect, useRef } from "react"
import MessageBubble from "./MessageBubble"
import ChatInput from "./ChatInput"
import { audioState } from "../lib/audioState"
import { personalities, defaultPersonality, buildSystemPrompt } from "../lib/personalities"

// Strip stage directions, action descriptions, and markdown so TTS doesn't read them.
// Order matters: remove bracketed/asterisked CONTENT before generic char filters.
function sanitizeForTTS(text: string): string {
  return text
    .replace(/\*[^*\n]+\*/g, '')      // *adjusts monocle*
    .replace(/_[^_\n]+_/g, '')         // _leans forward_
    .replace(/\[[^\]\n]+\]/g, '')      // [smiles warmly]
    .replace(/\([^)\n]*\b(?:laughs|smiles|sighs|nods|chuckles|grins|pauses|whispers|shrugs)\b[^)\n]*\)/gi, '') // (laughs)
    .replace(/\*\*/g, '')
    .replace(/#{1,6}\s/g, '')
    .replace(/`/g, '')
    .replace(/[^\w\s,.!?'-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

    export default function ChatPanel() {
    const [messages, setMessages] = useState<{role: string, content: string, personality?: string}[]>([])
    const [sessionId, setSessionId] = useState<string | null>(null)
    const [isLoading, setIsLoading] = useState(false)
    const [personality, setPersonality] = useState(defaultPersonality)
    const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

    useEffect(() => {
      async function initSession() {
        // Load personality
        const savedPersonality = localStorage.getItem("tinman-personality")
        if (savedPersonality && personalities[savedPersonality]) {
          setPersonality(savedPersonality)
        }

        // Check for existing session
        const savedId = localStorage.getItem("tinman-session-id")
        if (savedId) {
          const res = await fetch(`/api/sessions/${savedId}/messages`)
          if (res.ok) {
            const msgs = await res.json()
            if (msgs.length > 0) {
              setMessages(msgs.map((m: any) => ({ role: m.role, content: m.content, personality: m.personality })))
              setSessionId(savedId)
              return
            }
          }
        }
        // Create new session
        const res = await fetch("/api/sessions", { method: "POST" })
        const session = await res.json()
        setSessionId(session.id)
        localStorage.setItem("tinman-session-id", session.id)
      }
      initSession()
    }, [])

    async function speakSentence(text: string, voiceLocal?: string, voiceCloud?: string) {
    // Skip empty or too-short text
    const cleaned = text.replace(/\./g, '').replace(/\s/g, '').trim()
    if (cleaned.length < 2) return null

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10000)

      const ttsResponse = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voiceLocal, voiceCloud }),
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
    audioState.stop()
    setIsLoading(true)

    // Reload personality in case it changed on settings page
    const currentPersonality = localStorage.getItem("tinman-personality") || defaultPersonality
    setPersonality(currentPersonality)
    const p = personalities[currentPersonality]

    const updated = [...messages, { role: "user", content: message }]
    setMessages(updated)

    try {
      await fetch(`/api/sessions/${sessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "user", content: message, personality: currentPersonality }),
      })

      // Limit history to last 20 messages to avoid old personality dominating
      const recentMessages = updated.slice(-20)

      // Convert other-personality assistant messages to user-role context notes.
      // Why: leaving them as assistant-role with inline [Name]: tags causes the
      // model to treat the history as a tagged transcript and auto-complete
      // multiple [Name]: turns in a single response.
      const taggedMessages = recentMessages.map(m => {
        if (m.role === "assistant" && m.personality && m.personality !== currentPersonality) {
          const otherName = personalities[m.personality]?.name || m.personality
          return { role: "user" as const, content: `(Context: earlier in this session, ${otherName} said: "${m.content}")` }
        }
        if (m.role === "user" && m.personality && m.personality !== currentPersonality) {
          const otherName = personalities[m.personality]?.name || m.personality
          return { role: "user" as const, content: `(Context: the user previously said this to ${otherName}, not to you: "${m.content}")` }
        }
        return { role: m.role, content: m.content }
      })

      // Always remind the model who it is when mixed personalities exist
      const hasOtherPersonality = recentMessages.some(m => m.personality && m.personality !== currentPersonality)
      if (hasOtherPersonality) {
        // Insert reminder right before the latest user message
        taggedMessages.splice(-1, 0, {
          role: "user" as const,
          content: `[IMPORTANT: You are ${p.name}. The user is now talking to YOU. Do NOT respond as ${Object.values(personalities).filter(x => x.id !== currentPersonality).map(x => x.name).join(" or ")}. Respond only as ${p.name}.]`,
        })
      }

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: taggedMessages, systemPrompt: buildSystemPrompt(currentPersonality, localStorage.getItem(`tinman-desc-${currentPersonality}`) || undefined) }),
      })

      if (!response.body) return
      
      const reader = response.body.getReader()
      const decoder = new TextDecoder("utf-8", { fatal: false })
      let aiMessage = ""
      let spokenText = ""
      const sentences: string[] = []

      // Strip non-speakable content from text before sentence detection.
      // - Tool calls: URL dots fool the sentence splitter into TTS'ing fragments
      // - Code blocks: nobody wants to hear Arthur dictate Python line by line
      // - Inline code: keep the content but drop the backticks (handled by sanitizer)
      const stripToolCalls = (s: string) =>
        s
          .replace(/```[\s\S]*?```/g, '')      // fenced code blocks
          .replace(/\[TOOL_CALL:[\s\S]*?\]/g, '')

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

              // Sentence detection runs on the tool-call-stripped text only.
              // This avoids URL fragments inside tool calls being sent to TTS.
              const speakable = stripToolCalls(aiMessage)
              const unspoken = speakable.slice(spokenText.length)
              const sentenceMatch = unspoken.match(/[^.!?]*[.!?]\s*/g)
              if (sentenceMatch) {
                for (const sentence of sentenceMatch) {
                  spokenText += sentence
                  const cleanText = sanitizeForTTS(sentence)
                  if (cleanText) sentences.push(cleanText)
                }
              }
            }
          } catch {
            // incomplete JSON, skip
          }
        }
      }

      // Add any remaining text (tool calls already stripped)
      const remainingRaw = stripToolCalls(aiMessage).slice(spokenText.length).trim()
      const remaining = sanitizeForTTS(remainingRaw)
      if (remaining) sentences.push(remaining)

      // Check for tool calls in the response
      const toolCallMatch = aiMessage.match(/\[TOOL_CALL:\s*(\w+)\s*\|\s*(\{[\s\S]*?\})\s*\]/)
      if (toolCallMatch) {
        const toolName = toolCallMatch[1]
        let toolArgs: Record<string, string> = {}
        try { toolArgs = JSON.parse(toolCallMatch[2]) } catch {}

        // Strip ALL tool calls from displayed message (model sometimes loops and emits many)
        const cleanContent = aiMessage.replace(/\[TOOL_CALL:[\s\S]*?\]/g, "").trim()
        setMessages([...updated, { role: "assistant", content: cleanContent || `Using ${toolName}...` }])

        // Execute the tool
        const toolResult = await fetch("/api/tools", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tool: toolName, args: toolArgs }),
        }).then(r => r.json())

        // Save tool result to DB so other personalities can see it
        const truncatedResult = toolResult.result?.slice(0, 5000) || ""
        await fetch(`/api/sessions/${sessionId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: "user", content: `[Tool: ${toolName}] ${truncatedResult}`, personality: "system" }),
        })

        // Feed result back to LLM for final response
        const followUp = [
          ...updated,
          { role: "assistant", content: cleanContent },
          { role: "user", content: `[Tool result from ${toolName}]:\n${toolResult.result}` },
        ]

        const followUpResponse = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: followUp, systemPrompt: buildSystemPrompt(currentPersonality, localStorage.getItem(`tinman-desc-${currentPersonality}`) || undefined) }),
        })

        if (followUpResponse.body) {
          const followReader = followUpResponse.body.getReader()
          let followMessage = ""
          let followBuffer = ""

          while (true) {
            const { done: fDone, value: fValue } = await followReader.read()
            if (fDone) break
            followBuffer += decoder.decode(fValue, { stream: true })
            const fLines = followBuffer.split("\n")
            followBuffer = fLines.pop() || ""
            for (const fLine of fLines) {
              if (!fLine.trim()) continue
              try {
                const fData = JSON.parse(fLine)
                if (fData.message?.content) {
                  followMessage += fData.message.content
                  setMessages([...updated, { role: "assistant", content: followMessage }])
                }
              } catch {}
            }
          }
          aiMessage = followMessage

          // Collect sentences from follow-up for TTS — strip tool calls first
          const speakableFollow = stripToolCalls(followMessage)
          const followSentences = speakableFollow.match(/[^.!?]*[.!?]\s*/g) || [speakableFollow]
          for (const s of followSentences) {
            const clean = sanitizeForTTS(s)
            if (clean) sentences.push(clean)
          }
        }
      }

      // Save to DB immediately
      const savedMsg = await fetch(`/api/sessions/${sessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "assistant", content: aiMessage, personality: currentPersonality }),
      }).then(r => r.json())

      // Extract topics in background — don't block UI
      fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userMessage: message,
          assistantMessage: aiMessage,
          messageId: savedMsg.id,
        }),
      }).catch(() => {})

      // Play audio sequentially — one TTS request at a time
      ;(async () => {
    const audioContext = new AudioContext()
    const analyser = audioContext.createAnalyser()
    analyser.fftSize = 256
    analyser.connect(audioContext.destination)
    const dataArray = new Uint8Array(analyser.frequencyBinCount)

    // Pre-fetch next sentence while current one plays
    audioState.cancelAudio = false
    let nextAudioPromise: Promise<HTMLAudioElement | null> | null =
      sentences.length > 0 ? speakSentence(sentences[0], p.voiceLocal, p.voiceCloud) : null

    for (let i = 0; i < sentences.length; i++) {
      if (audioState.cancelAudio) break
      try {
        const audio = await nextAudioPromise
        if (audioState.cancelAudio) { audio?.pause(); break }
        // Start fetching the NEXT sentence immediately
        nextAudioPromise = i + 1 < sentences.length ? speakSentence(sentences[i + 1], p.voiceLocal, p.voiceCloud) : null

        if (audio) {
          const source = audioContext.createMediaElementSource(audio)
          source.connect(analyser)

          audioState.currentAudio = audio
          await audioContext.resume()
          audio.play()

          const updateVolume = () => {
            if (!audio.paused) {
              analyser.getByteFrequencyData(dataArray)
              const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length
              audioState.setVolume(Math.min(avg / 80, 1))
              requestAnimationFrame(updateVolume)
            } else {
              audioState.setVolume(0)
            }
          }
          updateVolume()

          await new Promise<void>(resolve => {
            audio.onended = () => {
              audioState.setVolume(0)
              resolve()
            }
            audio.onerror = () => {
              audioState.setVolume(0)
              resolve()
            }
          })
        }
      } catch (e) {
        console.error("Audio playback error:", e)
        audioState.setVolume(0)
      }
    }
    audioContext.close()
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

  async function handleSendImage(message: string, imageBase64: string) {
    if (!sessionId) return
    setIsLoading(true)

    const currentPersonality = localStorage.getItem("tinman-personality") || defaultPersonality
    setPersonality(currentPersonality)
    const p = personalities[currentPersonality]

    const updated = [...messages, { role: "user" as const, content: message }]
    setMessages(updated)

    try {
      // Save user message
      await fetch(`/api/sessions/${sessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "user", content: message, personality: currentPersonality }),
      })

      // Send to vision API
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: updated,
          systemPrompt: buildSystemPrompt(currentPersonality, localStorage.getItem(`tinman-desc-${currentPersonality}`) || undefined),
          image: imageBase64,
        }),
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
          } catch {}
        }
      }

      // Save assistant response
      const savedMsg = await fetch(`/api/sessions/${sessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "assistant", content: aiMessage, personality: currentPersonality }),
      }).then(r => r.json())

      // Extract topics
      fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userMessage: message, assistantMessage: aiMessage, messageId: savedMsg.id }),
      }).catch(() => {})

    } catch (error) {
      console.error("Image chat error:", error)
      setMessages(prev => [...prev, { role: "assistant", content: "Sorry, something went wrong analyzing the image." }])
    } finally {
      setIsLoading(false)
    }
  }

    return (
      <div className="flex flex-col flex-1 p-4 overflow-hidden">
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
        <ChatInput onSend={handleSend} onSendImage={handleSendImage} />
      </div>
    )
  }