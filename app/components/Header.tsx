import Link from "next/link"

export default function Header({
  collabMode,
  onCollabToggle,
}: {
  collabMode?: boolean
  onCollabToggle?: () => void
} = {}) {
  return (
    <header className="flex items-center justify-between w-full bg-zinc-800 px-6 py-3">
      <Link href="/" className="text-xl font-bold text-white hover:text-blue-400">
        Ensemble
      </Link>
      <div className="flex items-center gap-6">
        {onCollabToggle !== undefined && (
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={collabMode ?? false}
              onChange={onCollabToggle}
              className="w-4 h-4 accent-purple-500"
            />
            <span className={`text-sm font-medium transition ${collabMode ? "text-purple-300" : "text-zinc-400"}`}>
              Collab
            </span>
          </label>
        )}
        <nav className="flex gap-6">
          <Link href="/" className="text-zinc-400 hover:text-white">
            Home
          </Link>
          <Link href="/chat" className="text-zinc-400 hover:text-white">
            Chat
          </Link>
          <Link href="/about" className="text-zinc-400 hover:text-white">
            About
          </Link>
          <Link href="/settings" className="text-zinc-400 hover:text-white">
            Settings
          </Link>
        </nav>
      </div>
    </header>
  )
}