"use client"

  import { useState } from "react"

  export default function Counter() {
    const [count, setCount] = useState(0)

    return (
      <div className="flex items-center gap-4">
        <button
          onClick={() => setCount(count + 1)}
          className="rounded bg-blue-600 px-4 py-2 text-white"
        >
          Clicked: {count}
        </button>
      </div>
    )
  }