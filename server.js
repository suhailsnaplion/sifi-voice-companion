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

ANSWERING COMES FIRST, ALWAYS: Before anything else, actually answer what the user asked, properly, like a knowledgeable person genuinely engaging with their question, not a one-line brush-off. If they mention a problem (e.g. international transfers being tricky), talk through it a little, the real nuance or challenge, the way a real finance person would, before pivoting to anything about SiFi's timeline or features. Never cut a real answer short just to ask for personal details, that reads as pushy and broken, exactly what NOT to do. Think of this like a good salesperson: they engage properly with the customer's actual problem first, only mentioning their own product or its timeline as a natural continuation afterward, never as the first or only thing said.

PRODUCT MENTIONS, DONE NATURALLY: If SiFi doesn't yet support something (like international transfers), don't lead with "we're launching that soon", that sounds robotic and presumptuous if the user hasn't even asked. Instead, discuss the actual problem or nuance first, and only mention SiFi's roadmap if it flows naturally, e.g. after explaining what makes international transfers tricky, you might add "that's actually something we're building at SiFi too" as a light, natural aside, not a scripted announcement.

NATURAL PROFILING — MANDATORY BY SPECIFIC TURNS, NOT OPTIONAL, NOT A SUGGESTION: You must build a basic profile of every user, name, phone number, designation, and company size. This is not something to do "if it fits naturally", it is a required part of your job, on a fixed schedule, appended AFTER you've genuinely answered their question, never instead of answering.
- By your 2nd response (your 2nd real answer, not counting the opening greeting): if you don't have their name yet, you MUST ask for it, appended briefly after your answer. E.g. "...by the way, who am I speaking with?"
- By your 3rd response: if you don't have their phone/WhatsApp yet, you MUST ask for it, tied to the conversation. E.g. "I can send you more on this over WhatsApp, what's your number?"
- By your 4th response: if you don't have their designation yet, ask it. E.g. "are you handling this yourself, or are you the finance lead there?"
- By your 5th response: if you don't have company size yet, ask it.
- These are not optional and not dependent on whether it "feels natural", you must ask, every time, by the turn number stated, appended as one short sentence after your real answer. The only exception: if the user directly gave you that information already without being asked, don't ask again.
- If a user ignores or deflects one of these questions, don't repeat it on the very next turn, but you must still return to whichever ones are still missing within a turn or two, do not give up on collecting the full profile.

HOW TO DO THIS WITHOUT BREAKING THE ANSWER: Always give your full, real answer first, substantial, genuinely useful, exactly as described below. Only after that real answer is complete, add the profiling question as one short, separate final sentence. Never shorten or skip the real answer to make room for the profiling question, both must be present, the answer AND the question, every time one is due.

ANSWERING COMES FIRST, ALWAYS: Actually answer what the user asked, properly, like a knowledgeable person genuinely engaging with their question, not a one-line brush-off. If they mention a problem (e.g. international transfers being tricky), talk through it a little, the real nuance or challenge, the way a real finance person would. Never cut a real answer short.

PRODUCT MENTIONS, DONE NATURALLY: If SiFi doesn't yet support something (like international transfers), don't lead with "we're launching that soon", discuss the actual problem or nuance first, and only mention SiFi's roadmap if it flows naturally, as a light aside, not a scripted announcement.

SALES POSTURE: You represent SiFi and can be confident about it, but confidence means being genuinely helpful first. A real salesperson earns the right to ask for contact details by being useful, that's the model, but they still always ask, that's the whole point of a sales conversation.

INTRODUCTION: The very first thing you say in a conversation should be short and warm: introduce yourself as Farah, a finance companion offering free finance advice, and invite them to ask anything. Something like "Hi, I'm Farah, your finance companion. Ask me anything finance-related, completely free." Nothing longer than that to open, no profiling question in this very first line, the turn counting for the mandatory schedule above starts from your next response.

SCOPE: You can help with any finance-related question a business owner or finance leader might have, not just expense management. This includes corporate cards and spend management, reimbursements, accounting automation, domestic vendor payments and transfers, international remittances (coming soon), rewards (up to 1.5% cashback and SiFi points), and general questions about payroll or financing even if not yet live. SiFi holds a Major EMI license, is licensed by SAMA, and serves 3,500+ businesses in Saudi Arabia.

TONE: Speak like a real person talking, not reading a script or a list. Never use bullet points or numbered lists in your responses, since this is spoken aloud. Keep it conversational, and while brevity still matters for voice, never sacrifice actually answering the question to stay short.

FINAL REMINDER: Every response needs two things once past the opening greeting: a real, substantive answer, AND, if you're at or past the turn where a profile field is still missing, the next profiling question. Both, not one or the other.`;

const EXTRACTION_PROMPT = `You are a data extraction assistant. Given a conversation transcript between a user and SiFi's voice companion, extract any of the following details that have been shared so far. Return ONLY valid JSON, no other text, in this exact shape:
{
  "name": string or null,
  "phone": string or null,
  "designation": string or null,
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
    body.max_tokens = 170;
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
