import { NextRequest } from "next/server"                                                                                                                   
  const TTS_URL = process.env.TTS_URL || "http://192.168.86.126:8883"                                                                                           
  const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY
  const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "pFZP5JQG7iQjIQuC4Bku"

  export async function POST(req: NextRequest) {
    const { text } = await req.json()

    if (ELEVENLABS_API_KEY) {
      return handleElevenLabs(text)
    }
    return handleChatterbox(text)
  }

  async function handleElevenLabs(text: string) {
    try {
      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "xi-api-key": ELEVENLABS_API_KEY!,
          },
          body: JSON.stringify({
            text,
            model_id: "eleven_multilingual_v2",
          }),
        }
      )

      if (!response.ok) {
        return new Response("ElevenLabs TTS failed", { status: 500 })
      }

      return new Response(response.body, {
        headers: { "Content-Type": "audio/mpeg" },
      })
    } catch {
      return new Response("TTS unavailable", { status: 503 })
    }
  }

  async function handleChatterbox(text: string) {
    try {
      const response = await fetch(`${TTS_URL}/v1/synthesize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: text,
          voice: "default",
          audioEncoding: "wav",
        }),
      })

      if (!response.ok) {
        return new Response("TTS failed", { status: 500 })
      }

      const data = await response.json()
      if (!data.audio) {
        return new Response("No audio returned", { status: 500 })
      }

      const audioBuffer = Buffer.from(data.audio, "base64")
      return new Response(audioBuffer, {
        headers: { "Content-Type": "audio/wav" },
      })
    } catch {
      return new Response("TTS unavailable", { status: 503 })
    }
  }