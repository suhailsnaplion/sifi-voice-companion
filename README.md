# SiFi Voice Companion — Demo Prototype

A working, deployable prototype of a voice-based financial companion for SiFi's
website. Uses OpenAI for the conversational brain, and the browser's free,
built-in Web Speech API for voice input/output (no per-message voice cost).
Includes natural, conversational lead profiling and a live dashboard.

## What's included

- `server.js` — Node/Express backend. Handles chat with OpenAI, and a background
  extraction step that pulls name/phone/company size/challenge out of each
  conversation without interrupting the flow.
- `public/index.html` + `styles.css` — a SiFi-styled landing page with the
  voice companion widget (bottom-right, matches SiFi's real site structure and
  green branding).
- `public/app.js` — frontend voice logic (SpeechRecognition for listening,
  SpeechSynthesis for speaking back, both free and built into the browser).
- `public/dashboard.html` — a live dashboard showing every captured
  conversation, what was learned, and a suggested next action per lead.

## Important, honest notes before you present this

1. **Voice input/output is via the browser's native Web Speech API.** This is
   genuinely free (no API cost), but quality and browser support vary,
   Chrome on desktop works best. For a real production version, a dedicated
   speech provider (e.g. ElevenLabs for voice, or a cloud STT service) would
   sound more natural and work more reliably across devices, but that comes
   with real per-minute cost. Worth being upfront about this trade-off if
   asked, this demo optimizes for zero cost and fast turnaround, not
   production polish.
2. **The conversational brain is OpenAI (gpt-4o-mini).** You'll need your own
   OpenAI API key to run this live.
3. **This is a demo/prototype**, not hardened for real production traffic,
   leads are stored in a simple JSON file, not a real database. Fine for a
   live interview demo, not for scale.

## How to run it locally first (to test before deploying)

```
cd sifi-voice-companion
npm install
export OPENAI_API_KEY=your_key_here
npm start
```

Then open http://localhost:3000 in Chrome. Click the mic button (bottom
right), allow microphone access when prompted, and talk. Open
http://localhost:3000/dashboard.html in another tab to watch leads populate
live as you talk.

## How to deploy it for free, so you can share a real link

**Render is the simplest option for this project** (a plain Node server, not
a Next.js app, so Vercel would need extra restructuring).

1. Push this folder to a new GitHub repository (create one on github.com,
   then `git init`, `git add .`, `git commit -m "SiFi voice companion demo"`,
   `git remote add origin <your-repo-url>`, `git push -u origin main`).
2. Go to https://render.com and sign up (free tier is enough for a demo).
3. Click "New +" → "Web Service", connect your GitHub repo.
4. Settings:
   - Build command: `npm install`
   - Start command: `npm start`
5. Under "Environment", add an environment variable:
   - Key: `OPENAI_API_KEY`
   - Value: your OpenAI API key
6. Click "Create Web Service". Render will give you a live URL
   (something like `https://sifi-voice-companion.onrender.com`) within a
   couple of minutes.

That URL is what you can share with Rami for a real, live test.

**Note on Render's free tier:** free services spin down after inactivity and
take ~30-60 seconds to wake up on the first request. If you're demoing this
live, open the link a minute or two before the call to make sure it's warm.

## Customizing the profiling behavior

All the "natural profiling" logic (when to ask for name, phone, company size,
challenge, and how to phrase it conversationally) lives in the
`SYSTEM_PROMPT` constant near the top of `server.js`. Edit that text directly
to change the assistant's personality, scope, or profiling pacing, no code
changes needed elsewhere.
