"use client"

  import { useState } from "react"
  import VoiceButton from "./VoiceButton"

  export default function ChatInput({ onSend }: { onSend: (message: string) => void }) {
    const [message, setMessage] = useState("")

    function sendMessage() {
      if (message.trim() === "") return
      onSend(message)
      setMessage("")
    }

    return (
      <div className="flex gap-2 pt-4">
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          placeholder="Type a message..."
          className="flex-1 rounded bg-zinc-800 p-2 text-white"
        />
        <VoiceButton onTranscript={(text) => onSend(text)} />
        <button
          onClick={sendMessage}
          className="rounded bg-blue-600 px-4 py-2 text-white"
        >
          Send
        </button>
      </div>
    )
  }