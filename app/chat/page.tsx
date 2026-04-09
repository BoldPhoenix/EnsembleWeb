"use client"

import { useState, useEffect } from "react"
import Header from "../components/Header"
import ChatPanel from "../components/ChatPanel"
import Avatar from "../components/Avatar"
import { personalities, defaultPersonality } from "../lib/personalities"

export default function Chat() {
  const [personality, setPersonality] = useState(defaultPersonality)

  useEffect(() => {
    const saved = localStorage.getItem("tinman-personality")
    if (saved && personalities[saved]) {
      setPersonality(saved)
    }

    // Listen for personality changes from settings page
    const handleStorage = (e: StorageEvent) => {
      if (e.key === "tinman-personality" && e.newValue && personalities[e.newValue]) {
        setPersonality(e.newValue)
      }
    }
    window.addEventListener("storage", handleStorage)
    return () => window.removeEventListener("storage", handleStorage)
  }, [])

  const p = personalities[personality]

  return (
    <div className="flex flex-col h-screen bg-zinc-900">
      <Header />
      <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
        <div className="w-full h-64 md:w-1/3 md:h-auto">
          <Avatar modelPath={p.model} />
        </div>
        <div className="flex flex-col w-full md:w-2/3">
          <ChatPanel />
        </div>
      </div>
    </div>
  )
}
