"use client"

import { useState, useEffect } from "react"
import Header from "../components/Header"
import { personalities, defaultPersonality } from "../lib/personalities"

export default function Settings() {
  const [activePersonality, setActivePersonality] = useState(defaultPersonality)

  useEffect(() => {
    const saved = localStorage.getItem("tinman-personality")
    if (saved && personalities[saved]) {
      setActivePersonality(saved)
    }
  }, [])

  function selectPersonality(id: string) {
    setActivePersonality(id)
    localStorage.setItem("tinman-personality", id)
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
                    {p.id === "aimee"
                      ? "Laid-back British gal with a leather jacket and sharp wit"
                      : "Proper British gentleman in a tweed vest with dry humor"}
                  </div>
                </button>
              ))}
            </div>
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
              Clears the current conversation and starts fresh.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-semibold text-white mb-4">Current Personality</h2>
            <div className="bg-zinc-800 rounded p-4">
              <p className="text-zinc-300 text-sm italic">
                &quot;{personalities[activePersonality].systemPrompt}&quot;
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
