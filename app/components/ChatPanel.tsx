"use client"

import { useState, useEffect, useRef } from "react"
import MessageBubble from "./MessageBubble"
import ChatInput from "./ChatInput"
import { audioState } from "../lib/audioState"
import { personalities, defaultPersonality, buildSystemPrompt } from "../lib/personalities"

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

    async function speakSentence(text: string, voiceId?: string) {
    // Skip empty or too-short text
    const cleaned = text.replace(/\./g, '').replace(/\s/g, '').trim()
    if (cleaned.length < 2) return null

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10000)

      const ttsResponse = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voiceId }),
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

      // Tag conversation history with personality names for context
      const taggedMessages = updated.map(m => ({
        role: m.role,
        content: m.role === "assistant" && m.personality && m.personality !== currentPersonality
          ? `[${personalities[m.personality]?.name || m.personality}]: ${m.content}`
          : m.content,
      }))

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

              // Collect complete sentences for TTS
              const unspoken = aiMessage.slice(spokenText.length)
              const sentenceMatch = unspoken.match(/[^.!?]*[.!?]\s*/g)
              if (sentenceMatch) {
                for (const sentence of sentenceMatch) {
                  spokenText += sentence
                  const cleanText = sentence.trim().replace(/\*\*/g, '').replace(/\*/g, '').replace(/#{1,6}\s/g, '').replace(/`/g, '').replace(/[^\w\s,.!?'-]/g, '')
                  if (cleanText) sentences.push(cleanText)
                }
              }
            }
          } catch {
            // incomplete JSON, skip
          }
        }
      }

      // Add any remaining text
      const remaining = aiMessage.slice(spokenText.length).trim().replace(/\*\*/g, '').replace(/\*/g, '').replace(/#{1,6}\s/g, '').replace(/`/g, '').replace(/[^\w\s,.!?'-]/g, '')
      if (remaining) sentences.push(remaining)

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
    let nextAudioPromise: Promise<HTMLAudioElement | null> | null =
      sentences.length > 0 ? speakSentence(sentences[0], p.voiceId) : null

    for (let i = 0; i < sentences.length; i++) {
      try {
        const audio = await nextAudioPromise
        // Start fetching the NEXT sentence immediately
        nextAudioPromise = i + 1 < sentences.length ? speakSentence(sentences[i + 1], p.voiceId) : null

        if (audio) {
          const source = audioContext.createMediaElementSource(audio)
          source.connect(analyser)

          await audioContext.resume()
          audio.play()

          const updateVolume = () => {
            if (!audio.paused) {
              analyser.getByteFrequencyData(dataArray)
              const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length
              audioState.volume = Math.min(avg / 80, 1)
              requestAnimationFrame(updateVolume)
            } else {
              audioState.volume = 0
            }
          }
          updateVolume()

          await new Promise<void>(resolve => {
            audio.onended = () => {
              audioState.volume = 0
              resolve()
            }
            audio.onerror = () => {
              audioState.volume = 0
              resolve()
            }
          })
        }
      } catch (e) {
        console.error("Audio playback error:", e)
        audioState.volume = 0
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
        <ChatInput onSend={handleSend} />
      </div>
    )
  }