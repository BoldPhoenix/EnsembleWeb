import Header from "../components/Header"
  import ChatPanel from "../components/ChatPanel"                                                                                                               
  import Avatar from "../components/Avatar"
                                                                                                                                                                
  export default function Home() {
    return (
      <div className="flex flex-col h-screen bg-zinc-900">
        <Header />
        <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
          <div className="w-full h-64 md:w-1/3 md:h-auto">
            <Avatar />
          </div>
          <div className="flex flex-col w-full md:w-2/3">
            <ChatPanel />
          </div>
        </div>
      </div>
    )
  }