import Header from "./components/Header"
import Link from "next/link"

export default function Home() {
  return (
    <div className="flex flex-col min-h-screen bg-zinc-900">
      <Header />
      <div className="flex flex-1 flex-col items-center justify-center gap-8 p-8">
        <h1 className="text-5xl font-bold text-white text-center">
          Meet the Duo That Turns Your AI Experience into an Event.
        </h1>
        <p className="text-xl text-zinc-400 max-w-2xl text-center">
          Why settle for a sterile chat box when you can have a partnership?
        </p>

        <div className="flex flex-col md:flex-row gap-8 max-w-4xl w-full">
          <div className="flex-1 bg-zinc-800 rounded-lg p-6 space-y-3">
            <h2 className="text-2xl font-bold text-cyan-300">Aimee: The Spark</h2>
            <p className="text-zinc-400">
              Chaotic, curious, and relentlessly fast. Aimee is the whirlwind of creativity
              you need when you&apos;re brainstorming the impossible or diving headfirst into a new
              project. She&apos;s the &quot;let&apos;s try it and see what happens&quot; energy that keeps your
              workflow from becoming a snooze-fest.
            </p>
          </div>
          <div className="flex-1 bg-zinc-800 rounded-lg p-6 space-y-3">
            <h2 className="text-2xl font-bold text-amber-300">Arthur: The Anchor</h2>
            <p className="text-zinc-400">
              Impeccably dressed and irritatingly precise. Arthur is your lead architect and
              curator of quality. He provides the rigor, the attention to detail, and the
              occasional snarky reminder that &quot;precision matters.&quot; He&apos;s the one who ensures the
              code actually works and the strategy is sound.
            </p>
          </div>
        </div>

        <p className="text-lg text-zinc-500 max-w-2xl text-center italic">
          One Interface. Two Personalities. Zero Boredom.
        </p>

        <p className="text-zinc-400 max-w-xl text-center">
          Whether you need a whirlwind of ideas or a masterclass in accuracy, you now have both.
          Stop chatting with a void and start collaborating with a team.
        </p>

        <Link
          href="/chat"
          className="rounded bg-blue-600 px-8 py-4 text-xl font-semibold text-white hover:bg-blue-500"
        >
          Start Collaborating
        </Link>
      </div>
    </div>
  )
}
