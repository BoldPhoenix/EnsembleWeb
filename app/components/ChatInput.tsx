"use client"

import { useState, useRef } from "react"
import VoiceButton from "./VoiceButton"

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"]

export default function ChatInput({ onSend, onSendImage }: {
  onSend: (message: string) => void
  onSendImage?: (message: string, imageBase64: string) => void
}) {
  const [message, setMessage] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)

  function sendMessage() {
    if (message.trim() === "") return
    onSend(message)
    setMessage("")
  }

  function handleFile(file: File) {
    if (IMAGE_TYPES.includes(file.type) && onSendImage) {
      // Read image as base64
      const reader = new FileReader()
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string
        // Strip the data:image/xxx;base64, prefix
        const base64 = dataUrl.split(",")[1]
        onSendImage(`[Image: ${file.name}]`, base64)
      }
      reader.readAsDataURL(file)
    } else {
      // Read as text
      const reader = new FileReader()
      reader.onload = (e) => {
        const content = e.target?.result as string
        if (content) {
          const prefix = `[File: ${file.name}]\n\`\`\`\n`
          const suffix = `\n\`\`\``
          const truncated = content.length > 10000
            ? content.slice(0, 10000) + "\n... (truncated)"
            : content
          onSend(`${prefix}${truncated}${suffix}`)
        }
      }
      reader.readAsText(file)
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    const items = e.clipboardData.items
    for (const item of items) {
      if (item.kind === "file") {
        e.preventDefault()
        const file = item.getAsFile()
        if (file) handleFile(file)
        return
      }
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  return (
    <div
      className="flex gap-2 pt-4"
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault()
            sendMessage()
          }
        }}
        onPaste={handlePaste}
        placeholder="Type a message... (paste or drop files)"
        rows={1}
        className="flex-1 rounded bg-zinc-800 p-2 text-white resize-none"
      />
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept="*/*"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleFile(file)
        }}
      />
      <button
        onClick={() => fileInputRef.current?.click()}
        className="rounded bg-zinc-600 px-3 py-2 text-white hover:bg-zinc-500"
        title="Upload file"
      >
        📎
      </button>
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
