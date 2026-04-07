import Link from "next/link"

  export default function Header() {
    return (
      <header className="flex items-center justify-between w-full bg-zinc-800 px-6 py-3">
        <Link href="/" className="text-xl font-bold text-white hover:text-blue-400">
          Tin Man Web
        </Link>
        <nav className="flex gap-6">
          <Link href="/" className="text-zinc-400 hover:text-white">
            Home
          </Link>
          <Link href="/chat" className="text-zinc-400 hover:text-white">
            Chat
          </Link>
        </nav>
      </header>
    )
  }