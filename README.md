# Ensemble

**Stop chatting with a void — start collaborating with a team.**

Ensemble is a full-stack AI collaboration platform featuring dual AI personalities with 3D animated avatars, real-time lip sync, voice cloning, web research tools, and persistent memory across sessions.

Meet **Aimee** (chaotic, creative, relentlessly fun) and **Arthur** (measured, precise, quietly sarcastic) — two AI personalities that share the same memory, can see each other's conversations, and have very strong opinions about each other.

> *"One Interface. Two Personalities. Zero Boredom."* — Arthur (who wrote his own marketing copy)

## Demo

**Live demo:** [tinmanweb.vercel.app](https://tinmanweb.vercel.app) *(URL pending Vercel project rename — limited, slow free API, no voice)*

**Full experience requires local setup** — instant responses, voice cloning, lip sync, the works.

## Features

- **Dual AI Personalities** — Aimee & Arthur with distinct voices, avatars, and system prompts
- **3D Animated Avatars** — react-three-fiber with idle animations and audio-driven lip sync
- **Voice Cloning** — ChatterboxTurbo for local cloned voices, ElevenLabs for cloud
- **Voice Input** — Push-to-talk via Web Speech API
- **Web Tools** — Search (DuckDuckGo), page reading (Jina Reader), YouTube transcripts, Reddit
- **File Upload** — Drag/drop, paste, or click to upload text files and images
- **Image Vision** — Drop an image and the AI analyzes it
- **Persistent Memory** — Three-tier system: topic index, session summaries, keyword recall
- **Cross-Personality Awareness** — Switch between Aimee and Arthur mid-conversation; they see each other's messages
- **Markdown Rendering** — Code blocks with copy buttons
- **Audio Interruption** — New message stops current speech
- **Customizable Personalities** — Edit descriptions via Settings page

## Prerequisites

- **Node.js** 20+ ([nodejs.org](https://nodejs.org))
- **Ollama** ([ollama.com](https://ollama.com)) with a chat model pulled
- **PostgreSQL** — [Neon](https://neon.tech) free tier (cloud) or local Postgres
- **Git**

### Optional (for voice)

- **ChatterboxTurbo** — local TTS with voice cloning
- **ElevenLabs** account — cloud TTS alternative ([elevenlabs.io](https://elevenlabs.io))

### Optional (for cloud deployment)

- **Vercel** account ([vercel.com](https://vercel.com))
- **OpenRouter** API key ([openrouter.ai](https://openrouter.ai)) — free tier available

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/BoldPhoenix/TinManWeb.git ensemble
cd ensemble
npm install
```

### 2. Set up the database

Create a free PostgreSQL database at [neon.tech](https://neon.tech) and get the connection string.

Or use a local PostgreSQL instance.

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Required — PostgreSQL connection string
DATABASE_URL="postgresql://user:password@host/dbname?sslmode=require"

# Required — Ollama URL (default assumes localhost)
# If Ollama runs on a different machine, change the IP
OLLAMA_URL="http://localhost:11434"

# Optional — ElevenLabs for cloud TTS (has free tier)
# ELEVENLABS_API_KEY="your-key-here"

# Optional — OpenRouter for cloud LLM (for Vercel deployment)
# OPENROUTER_API_KEY="your-key-here"
# OPENROUTER_MODEL="nvidia/nemotron-3-super-120b-a12b:free"

# Optional — Gemini as backup cloud LLM
# GEMINI_API_KEY="your-key-here"
```

### 4. Set up the database schema

```bash
npx prisma generate
npx prisma migrate dev --name init
```

> **Note:** If Prisma complains about missing `url` in the datasource, temporarily add `url = env("DATABASE_URL")` to the datasource block in `prisma/schema.prisma`, run the migration, then remove it. This is a Prisma 7 quirk.

### 5. Pull an Ollama model

```bash
ollama pull gemma4:31b-cloud    # Best quality (requires Ollama cloud)
# OR
ollama pull gemma3:4b            # Runs locally on most GPUs
# OR
ollama pull llama3               # Good general-purpose option
```

The model name is configured in `app/api/chat/route.ts` — change the `model:` value in `handleOllama()` to match whatever you pulled.

### 6. Start the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — you should see the Ensemble landing page.

Go to **Chat** and start talking to Aimee. Go to **Settings** to switch to Arthur.

## Voice Setup

Voice is optional but makes the experience dramatically better.

### Option A: ChatterboxTurbo (Local, Free, Voice Cloning)

ChatterboxTurbo runs locally and clones voices from audio samples.

1. Set up ChatterboxTurbo following its documentation
2. Place voice samples (10-30 second `.mp3` clips) in ChatterboxTurbo's voices directory:
   - `Aimee.mp3` — female British voice sample
   - `Arthur.mp3` — male British voice sample
3. Start ChatterboxTurbo on port 8883
4. Ensemble auto-detects it at `http://localhost:8883` (or set `TTS_URL` in `.env`)

### Option B: ElevenLabs (Cloud, Free Tier)

1. Create an account at [elevenlabs.io](https://elevenlabs.io)
2. Get your API key from Profile → API Keys
3. Add to `.env`:
   ```env
   ELEVENLABS_API_KEY="your-key-here"
   ```
4. Voice IDs are configured per personality in `app/lib/personalities.ts`

### Option C: Browser Speech (Zero Setup)

If no TTS provider is configured, the app uses the browser's built-in speech synthesis. Works but sounds robotic.

## Project Structure

```
app/
  page.tsx                — Landing page
  chat/page.tsx           — Chat interface with 3D avatar
  about/page.tsx          — About page with tech stack and links
  settings/page.tsx       — Personality switcher and settings
  api/
    chat/route.ts         — LLM proxy (Ollama / Gemini / OpenRouter)
    tts/route.ts          — TTS proxy (ChatterboxTurbo / ElevenLabs)
    tools/route.ts        — Web search, fetch, YouTube, Reddit
    sessions/route.ts     — Session CRUD
    sessions/[id]/messages/route.ts — Message CRUD
    memory/route.ts       — Topic extraction and recall
  components/
    Avatar.tsx            — 3D model with lip sync and backface fix
    ChatPanel.tsx         — Chat logic, streaming, TTS, tool calls
    ChatInput.tsx         — Text input, file upload, voice button
    MessageBubble.tsx     — Markdown rendering with code copy
    VoiceButton.tsx       — Push-to-talk speech recognition
    Header.tsx            — Navigation bar
  lib/
    db.ts                 — Prisma client singleton
    audioState.ts         — Shared audio state for lip sync
    memory.ts             — Topic extraction, recall, session summaries
    personalities.ts      — Personality definitions and system prompts
  generated/prisma/       — Generated Prisma client (gitignored)
public/
  Aimee.glb              — Aimee's 3D model
  Arthur.glb             — Arthur's 3D model
prisma/
  schema.prisma          — Database schema
  prisma.config.ts       — Prisma 7 config
```

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Framework | Next.js 16 / React 19 | Full-stack web framework |
| Language | TypeScript | Type safety |
| Styling | Tailwind CSS | Utility-first CSS |
| 3D | react-three-fiber / Three.js | Animated avatars with lip sync |
| LLM | Ollama / OpenRouter / Gemini | AI chat with streaming |
| TTS | ChatterboxTurbo / ElevenLabs / Web Speech API | Voice output with cloning |
| STT | Web Speech API | Voice input |
| Database | PostgreSQL / Prisma 7 | Chat and memory persistence |
| Web Tools | Jina Reader / DuckDuckGo | Search and page reading |
| Deployment | Vercel | Cloud hosting (optional) |

## Deploying to Vercel

1. Push to GitHub
2. Import project in [vercel.com](https://vercel.com)
3. Add environment variables:
   - `DATABASE_URL` — Neon Postgres connection string (no quotes!)
   - `OPENROUTER_API_KEY` — for cloud LLM
   - `ELEVENLABS_API_KEY` — for cloud TTS (optional)
4. Deploy — the build script runs `prisma generate` automatically

## Adding New Personalities

Edit `app/lib/personalities.ts`:

```typescript
newcharacter: {
  id: "newcharacter",
  name: "Display Name",
  model: "/NewCharacter.glb",
  voiceLocal: "NewCharacter.mp3",
  voiceCloud: "elevenlabs-voice-id",
  basePrompt: "You are NewCharacter. Never break character.",
  defaultDescription: "Description of personality and speaking style.",
},
```

Drop the GLB model in `public/` and the voice sample in ChatterboxTurbo's voices directory.

## Credits

Built by **Carl Roach** — Senior Software Engineer | AI & Automation

- [LinkedIn](https://www.linkedin.com/in/carl-roach-6b75874/)
- [US Patent 11509678B2](https://patents.google.com/patent/US11509678B2) — Automated Security Assessment Systems
- Landing page copy written by Arthur (he insisted on credit)

## License

MIT
