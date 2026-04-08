"use client"                                                                                                                                                
  import { useState, useRef } from "react"                                                                                                                    
  export default function VoiceButton({ onTranscript }: { onTranscript: (text: string) => void }) {
    const [isListening, setIsListening] = useState(false)
    const recognitionRef = useRef<any>(null)

    function toggleListening() {
      if (isListening) {
        recognitionRef.current?.stop()
        setIsListening(false)
        return
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
        onClick={toggleListening}
        className={`rounded px-4 py-2 text-white ${isListening ? "bg-red-600" : "bg-zinc-600 hover:bg-zinc-500"}`}
      >
        {isListening ? "..." : "Mic"}
      </button>
    )
  }