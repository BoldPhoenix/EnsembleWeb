import Header from "../components/Header"
import ChatPanel from "../components/ChatPanel"

export default function Home() {
  return (
    <div className="flex-1 h-screen bg-zinc-900">
      <Header title="Tin Man Web" />
      <h1 className="text-4xl font-bold text-white">
        Tin Man Web Chat Page
      </h1>
      <ChatPanel />
    </div>
  )
}