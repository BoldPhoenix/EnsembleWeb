"use client"

import { useState, useEffect } from "react"
import Header from "../components/Header"
import ChatPanel from "../components/ChatPanel"
import Avatar from "../components/Avatar"
import CollaborationPanel from "../components/CollaborationPanel"
import { personalities, defaultPersonality } from "../lib/personalities"

export default function Chat() {
  const [personality, setPersonality] = useState(defaultPersonality)
  const [collabMode, setCollabMode] = useState(false)

  useEffect(() => {
    const savedCollab = localStorage.getItem("ensemble-collab-mode")
    if (savedCollab === "true") setCollabMode(true)

    const saved = localStorage.getItem("ensemble-personality")
    if (saved && personalities[saved]) {
      setPersonality(saved)
    }

    // Listen for personality changes from settings page
    const handleStorage = (e: StorageEvent) => {
      if (e.key === "ensemble-personality" && e.newValue && personalities[e.newValue]) {
        setPersonality(e.newValue)
      }
    }
    window.addEventListener("storage", handleStorage)
    return () => window.removeEventListener("storage", handleStorage)
  }, [])

  const p = personalities[personality]

  return (
    <div className="flex flex-col h-screen bg-zinc-900">
      <Header
        collabMode={collabMode}
        onCollabToggle={() => setCollabMode(prev => {
          const next = !prev
          localStorage.setItem("ensemble-collab-mode", String(next))
          return next
        })}
      />
      {collabMode ? (
        <div className="flex flex-col flex-1 overflow-hidden">
          <CollaborationPanel />
        </div>
      ) : (
        <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
          <div className="w-full h-64 md:w-1/3 md:h-auto">
            <Avatar modelPath={p.model} />
          </div>
          <div className="flex flex-col w-full md:w-2/3">
            <ChatPanel />
          </div>
        </div>
      )}
    </div>
  )
}
