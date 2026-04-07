export default function Header({ title }: { title: string }) {
    return (
      <header className="w-full bg-zinc-800 p-4">
        <h1 className="text-2xl font-bold text-white">{title}</h1>
      </header>
    )
  }