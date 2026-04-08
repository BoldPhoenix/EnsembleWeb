"use client"

import { useState, useRef } from "react"

export default function VoiceButton({
  onTranscript,
}: {
  onTranscript: (text: string) => void
}) {
  const [isListening, setIsListening] = useState(false)
  const recognitionRef = useRef<any>(null)

  function startListening() {
    if (recognitionRef.current) {
      try { recognitionRef.current.abort() } catch {}
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      alert("Speech recognition not supported in this browser")
      return
    }

    const recognition = new SpeechRecognition()
    recognition.lang = "en-US"
    recognition.continuous = false
    recognition.interimResults = false

    recognition.onresult = (event: any) => {
      const text = event.results[0][0].transcript
      onTranscript(text)
      setIsListening(false)
    }

    recognition.onerror = () => {
      setIsListening(false)
    }

    recognition.onend = () => {
      setIsListening(false)
    }

    recognitionRef.current = recognition
    recognition.start()
    setIsListening(true)
  }

  return (
    <button
      onClick={() => isListening ? (recognitionRef.current?.abort(), setIsListening(false)) : startListening()}
      className={`rounded px-4 py-2 text-white ${isListening ? "bg-red-600" : "bg-zinc-600 hover:bg-zinc-500"}`}
    >
      {isListening ? "Listening..." : "🎤 Talk"}
    </button>
  )
}
