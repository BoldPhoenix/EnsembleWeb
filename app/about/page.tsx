import Header from "../components/Header"
  import Link from "next/link"
                                                                                                                                                                export default function About() {
    return (                                                                                                                                                        <div className="flex flex-col h-screen bg-zinc-900">
        <Header />
        <div className="flex flex-1 flex-col items-center justify-center gap-8 p-8">
          <h1 className="text-4xl font-bold text-white">About Tin Man Web</h1>

          <div className="max-w-2xl text-zinc-300 space-y-4">
            <p>
              Tin Man Web is a full-stack AI chat application featuring a 3D animated avatar
              with real-time lip sync, streaming AI responses, voice input/output, and
              persistent chat history. Built as both a portfolio piece and a foundation
              for the commercial Tin Man desktop product.
            </p>

            <p>
              The avatar, Aimee (Artificial Intelligence Model with Exceptional Enthusiasm),
              designed her own 3D model and developed her personality from a 15-word description.
              She speaks with a British accent and has opinions about everything.
            </p>

            <h2 className="text-2xl font-semibold text-white pt-4">Tech Stack</h2>
            <ul className="list-disc list-inside space-y-1 text-zinc-400">
              <li>Next.js 16 / React 19 / TypeScript</li>
              <li>Tailwind CSS</li>
              <li>react-three-fiber / Three.js — 3D avatar with morph target lip sync</li>
              <li>Ollama / Google Gemini — LLM streaming</li>
              <li>ElevenLabs / ChatterboxTurbo — text-to-speech</li>
              <li>Web Speech API — voice input</li>
              <li>PostgreSQL (Neon) / Prisma 7 — chat persistence</li>
              <li>Vercel — deployment</li>
            </ul>

            <h2 className="text-2xl font-semibold text-white pt-4">Built By</h2>
            <p>
              <span className="text-white font-semibold">Carl Roach</span> — Senior Software Engineer | AI & Automation
            </p>
            <p className="text-zinc-400">
              Co-inventor of US Patent 11509678B2 — Automated Security Assessment Systems (STIG/DoD compliance automation).
            </p>

            <div className="flex gap-4 pt-4">
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
                Try Aimee
              </Link>
            </div>
          </div>
        </div>
      </div>
    )
  }