export default function MessageBubble({ role, content }: { role: string, content: string }) {
    return (
      <div className={`flex ${role === "user" ? "justify-end" : "justify-start"}`}>
        <div className={`rounded p-3 max-w-2xl ${role === "user" ? "bg-blue-600 text-white" : "bg-zinc-700 text-cyan-200"}`}>
          {content}
        </div>
      </div>
    )
  }