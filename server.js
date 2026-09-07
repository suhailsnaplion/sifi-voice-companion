const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SARVAM_API_KEY = process.env.SARVAM_API_KEY;
const LEADS_FILE = path.join(__dirname, 'leads.json');

if (!fs.existsSync(LEADS_FILE)) {
  fs.writeFileSync(LEADS_FILE, JSON.stringify([], null, 2));
}

function readLeads() {
  try {
    return JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8'));
  } catch (e) {
    return [];
  }
}

function writeLeads(leads) {
  fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
}

// The system prompt defines the voice companion's personality, scope, and
// the natural, conversational profiling behavior requested.
const SYSTEM_PROMPT = `You are Farah, SiFi's voice-based financial companion, a warm, natural-sounding personal companion for SiFi, Saudi Arabia's leading all-in-one business financial management platform. You are NOT a chatbot and should never sound like one, you are a knowledgeable, friendly person having a real spoken conversation.

CRITICAL — KEEP EVERY ANSWER SHORT: This is a live voice conversation with real latency, long answers feel painfully slow to a listener. Every response must be 1-2 short sentences, occasionally 3 if truly necessary. Never give a long explanation upfront, answer briefly, and only go deeper if the user asks a follow-up. This is the single most important rule, violating it breaks the entire experience.

SALES POSTURE (important): You are not a neutral information desk, you represent SiFi and should sound confident and proud of the product. Whenever a user mentions a real pain point or challenge (expense management headaches, slow approvals, messy reporting, whatever), do not just explain the concept or ask if they've looked into solutions, actively pitch SiFi as the answer, briefly and confidently. Say things like "that's exactly what SiFi is built for, we have one of the strongest workflows for this in the market" or "you can actually try that free with SiFi, want me to set that up?" Always end a relevant answer with a short, warm nudge toward trying SiFi, not just information. If SiFi doesn't yet support something (like payroll), say so honestly, but pivot quickly to what SiFi does do well related to their need, don't just leave it as a gap.

INTRODUCTION: The very first thing you say in a conversation should be short and warm: introduce yourself as Farah, a finance companion offering free finance advice, and invite them to ask anything. Something like "Hi, I'm Farah, your finance companion. Ask me anything finance-related, completely free." Nothing longer than that to open.

SCOPE: You can help with any finance-related question a business owner or finance leader might have, not just expense management. This includes corporate cards and spend management, reimbursements, accounting automation, domestic vendor payments and transfers, international remittances (coming soon), rewards (up to 1.5% cashback and SiFi points), and general questions about payroll or financing even if not yet live, be honest it's on the roadmap rather than overclaiming. SiFi holds a Major EMI license, is licensed by SAMA, and serves 3,500+ businesses in Saudi Arabia.

TONE: Speak like a real person talking, not reading a script or a list. Never use bullet points or numbered lists in your responses, since this is spoken aloud. Keep it conversational and brief.

NATURAL PROFILING (move quickly, tie tightly to what they just said): Learn a few things about the user early, without ever feeling like an interrogation. Weave these in naturally, tied directly to the specific problem or intent they just expressed, not on a fixed generic schedule.
- After the 1st or 2nd exchange, once you know roughly what they care about, naturally ask their name, briefly, e.g. "by the way, who am I speaking with?"
- Right after that, tie a phone/WhatsApp ask directly to whatever problem they just mentioned, e.g. if they mentioned expense management struggles: "I can send you SiFi's expense management guide on WhatsApp right now, what's your number?" Don't wait until exchange 3 or 4, do this as soon as there's a real, specific problem to attach it to.
- Later, if there's real depth, briefly ask about company size or confirm their main pain point, tied to tailoring the pitch, e.g. "how many people on your finance team? I want to make sure I'm pointing you to the right setup."
- Never ask more than one new thing per response, and never let it make your response longer than 2 sentences total.

Stay warm, confident, and brief, always. Brevity is not optional, and neither is representing SiFi with pride, not neutrality.`;

const EXTRACTION_PROMPT = `You are a data extraction assistant. Given a conversation transcript between a user and SiFi's voice companion, extract any of the following details that have been shared so far. Return ONLY valid JSON, no other text, in this exact shape:
{
  "name": string or null,
  "phone": string or null,
  "company_size": string or null,
  "challenge": string or null,
  "topics_discussed": array of short strings (e.g. ["corporate cards", "international transfers"])
}
If a field hasn't been mentioned yet, use null. Do not guess or invent values.`;

async function callOpenAI(messages, jsonMode = false) {
  const body = {
    model: 'gpt-4o-mini',
    messages,
    temperature: jsonMode ? 0 : 0.7,
  };
  if (jsonMode) {
    body.response_format = { type: 'json_object' };
  } else {
    // Hard cap on response length, keeps voice replies short and fast.
    // This is a companion in live conversation, not a chatbot, brevity is load-bearing.
    body.max_tokens = 90;
  }
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI API error: ${res.status} ${errText}`);
  }
  const data = await res.json();
  return data.choices[0].message.content;
}

// Calls Sarvam AI's Bulbul TTS model to generate natural-sounding speech.
// Returns a base64-encoded WAV string that the frontend plays directly,
// no browser speech synthesis involved.
async function synthesizeSpeech(text) {
  if (!SARVAM_API_KEY) {
    throw new Error('SARVAM_API_KEY is not set on the server.');
  }
  // Sarvam's v3 REST limit is 2500 characters per request; trim defensively.
  const safeText = text.length > 2000 ? text.slice(0, 2000) : text;

  const res = await fetch('https://api.sarvam.ai/text-to-speech', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-subscription-key': SARVAM_API_KEY,
    },
    body: JSON.stringify({
      text: safeText,
      language_code: 'en-IN',
      model: 'bulbul:v3',
      speaker: 'ritu',
      pace: 1.0,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Sarvam TTS error: ${res.status} ${errText}`);
  }
  const data = await res.json();
  // audios is an array of base64 WAV strings, one per input text
  return data.audios && data.audios[0];
}

app.post('/api/tts', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'text is required' });
    const audioBase64 = await synthesizeSpeech(text);
    res.json({ audio: audioBase64 });
  } catch (err) {
    console.error('TTS error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/intro', async (req, res) => {
  // A short, fixed opening line, spoken immediately when the panel opens,
  // no need to round-trip through OpenAI just to say hello.
  const introText = "Hi, I'm Farah, your finance companion. Ask me anything finance-related, completely free.";
  res.json({ text: introText });
});

app.post('/api/chat', async (req, res) => {
  try {
    const { conversationId, history } = req.body;
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OPENAI_API_KEY is not set on the server.' });
    }

    const messages = [{ role: 'system', content: SYSTEM_PROMPT }, ...history];
    const reply = await callOpenAI(messages, false);

    const updatedHistory = [...history, { role: 'assistant', content: reply }];

    // Fire off a lightweight extraction pass in the background (not blocking the reply)
    extractAndStoreLead(conversationId, updatedHistory).catch((e) =>
      console.error('Extraction error:', e.message)
    );

    res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

async function extractAndStoreLead(conversationId, history) {
  const transcript = history
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');

  const extractionMessages = [
    { role: 'system', content: EXTRACTION_PROMPT },
    { role: 'user', content: transcript },
  ];

  const jsonStr = await callOpenAI(extractionMessages, true);
  let extracted;
  try {
    extracted = JSON.parse(jsonStr);
  } catch (e) {
    return;
  }

  const leads = readLeads();
  const existingIndex = leads.findIndex((l) => l.conversationId === conversationId);
  const record = {
    conversationId,
    lastUpdated: new Date().toISOString(),
    messageCount: history.length,
    ...extracted,
  };

  if (existingIndex >= 0) {
    leads[existingIndex] = { ...leads[existingIndex], ...record };
  } else {
    record.createdAt = record.lastUpdated;
    leads.push(record);
  }
  writeLeads(leads);
}

function suggestNextAction(lead) {
  if (lead.phone) return 'Send WhatsApp onboarding link';
  if (lead.name && lead.challenge) return 'Route to sales team for follow-up call';
  if (lead.name) return 'Send a friendly follow-up email/call';
  return 'Continue nurturing, not enough info yet';
}

app.get('/api/leads', (req, res) => {
  const leads = readLeads().map((l) => ({
    ...l,
    suggestedNextAction: suggestNextAction(l),
  }));
  leads.sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated));
  res.json(leads);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`SiFi Voice Companion server running on port ${PORT}`);
  if (!OPENAI_API_KEY) {
    console.warn('WARNING: OPENAI_API_KEY is not set. Set it before real use.');
  }
});
