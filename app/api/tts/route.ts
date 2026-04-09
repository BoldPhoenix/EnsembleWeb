import { NextRequest } from "next/server"                                                                                                                   
  const TTS_URL = process.env.TTS_URL || "http://localhost:8883"                                                                                           
  const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY
  const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "pFZP5JQG7iQjIQuC4Bku"

  export async function POST(req: NextRequest) {
    const { text, voiceLocal, voiceCloud } = await req.json()

    if (ELEVENLABS_API_KEY) {
      return handleElevenLabs(text, voiceCloud)
    }
    // On Vercel (no local network), skip TTS entirely
    if (process.env.VERCEL) {
      return new Response("No TTS provider on cloud", { status: 503 })
    }
    return handleChatterbox(text, voiceLocal)
  }

  async function handleElevenLabs(text: string, voiceId?: string) {
    try {
      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId || ELEVENLABS_VOICE_ID}`,
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
        const errorText = await response.text()
        console.error("ElevenLabs error:", response.status, errorText)
        return new Response(`ElevenLabs TTS failed: ${response.status} ${errorText}`, { status: 500 })
      }

      return new Response(response.body, {
        headers: { "Content-Type": "audio/mpeg" },
      })
    } catch {
      return new Response("TTS unavailable", { status: 503 })
    }
  }

  async function handleChatterbox(text: string, voiceId?: string) {
    try {
      const response = await fetch(`${TTS_URL}/v1/synthesize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: text,
          voice: voiceId || "default",
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