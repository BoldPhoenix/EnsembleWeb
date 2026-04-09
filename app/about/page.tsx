import Header from "../components/Header"
import Link from "next/link"

export default function About() {
  return (
    <div className="flex flex-col min-h-screen bg-zinc-900">
      <Header />
      <div className="flex flex-1 flex-col items-center gap-8 p-8 overflow-y-auto">
        <h1 className="text-4xl font-bold text-white">About Tin Man Web</h1>

        <div className="max-w-2xl text-zinc-300 space-y-4">
          <p>
            Tin Man Web is a full-stack AI collaboration platform featuring dual AI personalities
            with 3D animated avatars, real-time lip sync, voice cloning, web research tools,
            and persistent memory across sessions. Built as both a portfolio piece and a foundation
            for the commercial Tin Man desktop product.
          </p>

          <h2 className="text-2xl font-semibold text-white pt-4">The Characters</h2>
          <p>
            <span className="text-cyan-300 font-semibold">Aimee</span> (Artificial Intelligence
            Model with Exceptional Enthusiasm) — designed her own 3D model, developed her full
            personality from a 15-word description, and once spent 20 minutes complaining about
            Blender in a British accent. She&apos;s the spark — chaotic, creative, and relentlessly fun.
          </p>
          <p>
            <span className="text-amber-300 font-semibold">Arthur</span> — a proper British
            gentleman AI in a tweed vest and flat cap. Self-described as &quot;irritatingly precise,&quot;
            he wrote his own marketing copy for the landing page and called Aimee &quot;a firecracker
            going off in a library.&quot; He&apos;s the anchor — measured, thoughtful, and quietly sarcastic.
          </p>
          <p>
            Both characters share the same memory and conversation history. Switch between them
            mid-conversation and they can see and comment on what the other said — like colleagues
            reviewing the same document with very different perspectives.
          </p>

          <h2 className="text-2xl font-semibold text-white pt-4">Key Features</h2>
          <ul className="list-disc list-inside space-y-1 text-zinc-400">
            <li>Dual AI personalities with distinct voices, avatars, and system prompts</li>
            <li>3D animated avatars with audio-driven lip sync</li>
            <li>Voice cloning via ChatterboxTurbo (local) / ElevenLabs (cloud)</li>
            <li>Push-to-talk voice input via Web Speech API</li>
            <li>Web search, page reading (Jina Reader), YouTube transcripts, Reddit</li>
            <li>File upload and image vision analysis</li>
            <li>Three-tier memory system: working memory, topic index, session summaries</li>
            <li>Markdown rendering with code copy buttons</li>
            <li>Cross-personality awareness and shared conversation history</li>
            <li>Customizable personality descriptions via Settings</li>
          </ul>

          <h2 className="text-2xl font-semibold text-white pt-4">Tech Stack</h2>
          <ul className="list-disc list-inside space-y-1 text-zinc-400">
            <li>Next.js 16 / React 19 / TypeScript</li>
            <li>Tailwind CSS</li>
            <li>react-three-fiber / Three.js — 3D avatars with morph target lip sync</li>
            <li>Ollama / Google Gemini — LLM streaming and vision</li>
            <li>ChatterboxTurbo / ElevenLabs — text-to-speech with voice cloning</li>
            <li>Web Speech API — voice input</li>
            <li>PostgreSQL (Neon) / Prisma 7 — chat and memory persistence</li>
            <li>Jina Reader — clean markdown web page extraction</li>
            <li>Vercel — deployment</li>
          </ul>

          <h2 className="text-2xl font-semibold text-white pt-4">Built By</h2>
          <p>
            <span className="text-white font-semibold">Carl Roach</span> — Senior Software Engineer | AI &amp; Automation
          </p>
          <p className="text-zinc-400">
            Co-inventor of US Patent 11509678B2 — Automated Security Assessment Systems
            (STIG/DoD compliance automation). Builder of CBASS, Tin Man, and an ever-growing
            family of AI-powered tools.
          </p>

          <div className="flex flex-wrap gap-4 pt-4">
            <a
              href="https://www.linkedin.com/in/carl-roach-6b75874/"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-500"
            >
              LinkedIn
            </a>
            <a
              href="https://github.com/BoldPhoenix/TinManWeb"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded bg-zinc-700 px-4 py-2 text-white hover:bg-zinc-600"
            >
              GitHub
            </a>
            <a
              href="https://patents.google.com/patent/US11509678B2"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded bg-zinc-700 px-4 py-2 text-white hover:bg-zinc-600"
            >
              Patent
            </a>
            <Link
              href="/chat"
              className="rounded bg-green-600 px-4 py-2 text-white hover:bg-green-500"
            >
              Try Aimee &amp; Arthur
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
