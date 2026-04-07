import Header from "./components/Header"
  import Link from "next/link"                                                                                                                                
  export default function Home() {                                                                                                                                return (
      <div className="flex flex-col h-screen bg-zinc-900">
        <Header />
        <div className="flex flex-1 flex-col items-center justify-center gap-6">
          <h1 className="text-5xl font-bold text-white">
            Meet Aim-E
          </h1>
          <p className="text-lg text-zinc-400 max-w-md text-center">
            An AI assistant with a personality, a face, and a voice.
            Built with Next.js, React, and Three.js.
          </p>
          <Link
            href="/chat"
            className="rounded bg-blue-600 px-6 py-3 text-lg font-semibold text-white hover:bg-blue-500"
          >
            Start Chatting
          </Link>
        </div>
      </div>
    )
  }
