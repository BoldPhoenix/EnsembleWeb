import Header from "../components/Header"
  import ChatPanel from "../components/ChatPanel"                                                                                                               
  import Avatar from "../components/Avatar"
                                                                                                                                                                
  export default function Home() {
    return (
      <div className="flex flex-col h-screen bg-zinc-900">
        <Header title="Tin Man Web" />
        <div className="flex flex-1 overflow-hidden">
          <div className="w-1/3">
            <Avatar />
          </div>
          <div className="flex flex-col w-2/3">
            <ChatPanel />
          </div>
        </div>
      </div>
    )
  }