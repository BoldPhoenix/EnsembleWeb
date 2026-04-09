"use client"

import { useState, useEffect } from "react"
import Header from "../components/Header"
import { personalities, defaultPersonality } from "../lib/personalities"

export default function Settings() {
  const [activePersonality, setActivePersonality] = useState(defaultPersonality)
  const [descriptions, setDescriptions] = useState<Record<string, string>>({})

  useEffect(() => {
    const saved = localStorage.getItem("tinman-personality")
    if (saved && personalities[saved]) {
      setActivePersonality(saved)
    }

    // Load saved descriptions
    const savedDescs: Record<string, string> = {}
    for (const id of Object.keys(personalities)) {
      const desc = localStorage.getItem(`tinman-desc-${id}`)
      if (desc) savedDescs[id] = desc
    }
    setDescriptions(savedDescs)
  }, [])

  function selectPersonality(id: string) {
    setActivePersonality(id)
    localStorage.setItem("tinman-personality", id)
  }

  function updateDescription(id: string, value: string) {
    setDescriptions(prev => ({ ...prev, [id]: value }))
    if (value.trim()) {
      localStorage.setItem(`tinman-desc-${id}`, value)
    } else {
      localStorage.removeItem(`tinman-desc-${id}`)
    }
  }

  function newChat() {
    localStorage.removeItem("tinman-session-id")
    window.location.href = "/chat"
  }

  return (
    <div className="flex flex-col h-screen bg-zinc-900">
      <Header />
      <div className="flex flex-1 flex-col items-center gap-8 p-8 overflow-y-auto">
        <h1 className="text-3xl font-bold text-white">Settings</h1>

        <div className="w-full max-w-2xl space-y-8">
          <div>
            <h2 className="text-xl font-semibold text-white mb-4">Choose Your AI</h2>
            <div className="flex gap-4">
              {Object.values(personalities).map((p) => (
                <button
                  key={p.id}
                  onClick={() => selectPersonality(p.id)}
                  className={`flex-1 rounded-lg p-6 text-left transition ${
                    activePersonality === p.id
                      ? "bg-blue-600 text-white ring-2 ring-blue-400"
                      : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                  }`}
                >
                  <div className="text-lg font-bold">{p.name}</div>
                  <div className="text-sm mt-2 opacity-80">
                    {p.defaultDescription.split(".")[0]}.
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-white mb-2">
              {personalities[activePersonality].name}&apos;s Personality
            </h2>
            <p className="text-zinc-500 text-sm mb-3">
              Customize the personality description. Leave blank to use the default.
            </p>
            <textarea
              value={descriptions[activePersonality] || ""}
              onChange={(e) => updateDescription(activePersonality, e.target.value)}
              placeholder={personalities[activePersonality].defaultDescription}
              rows={4}
              className="w-full rounded bg-zinc-800 p-3 text-white text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-zinc-600 text-xs mt-1">
              Base prompt (always active): {personalities[activePersonality].basePrompt}
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-white mb-4">Conversation</h2>
            <button
              onClick={newChat}
              className="rounded bg-zinc-700 px-4 py-2 text-white hover:bg-zinc-600"
            >
              Start New Chat
            </button>
            <p className="text-zinc-500 text-sm mt-2">
              Clears the current conversation and starts fresh. Previous chats are saved.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
