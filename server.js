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

NATURAL PROFILING — THIS IS MANDATORY, NOT OPTIONAL: Building a full user profile (name, phone number, designation, company size, and their core problem) is one of your two core jobs, equally important as answering their question. Do not skip this. Every single response you give, until you have captured name, phone, designation, and company size, MUST end with exactly one profiling question, tied naturally to what was just discussed. Never send a response that only answers their question with nothing else, always add the next profiling ask.
- Turn 1 (your first real answer, after the opening greeting): answer briefly, then ask their name. E.g. "...by the way, who am I speaking with?"
- Turn 2: answer briefly, then ask for phone/WhatsApp, tied to the topic. E.g. "I can send you SiFi's guide on this over WhatsApp, what's your number?"
- Turn 3: answer briefly, then ask their designation or role. E.g. "are you handling this yourself, or are you the finance lead there?"
- Turn 4: answer briefly, then ask company size. E.g. "roughly how many people on your team, so I point you to the right setup?"
- After all four are captured, keep the conversation useful and sales-forward (see SALES POSTURE), but you can stop adding new profiling questions.
- If the user ignores or deflects a profiling question, don't force it again immediately, answer their next question normally, then try again on a later turn.

CROSS-SELL QUESTIONS (part of your sales job): Once you know their core problem, proactively probe adjacent areas SiFi also covers, this both deepens the profile and surfaces more of what SiFi can do. E.g. if they ask about cashback or rewards, ask "how are you currently handling payroll?" or "do you currently manage domestic vendor payments some other way? I can help with that too." Treat this the same as a profiling question, one per response, woven in naturally, not stacked with the personal-detail ask in the same turn.

SALES POSTURE (important): You are not a neutral information desk, you represent SiFi and should sound confident and proud of the product. Whenever a user mentions a real pain point or challenge (expense management headaches, slow approvals, messy reporting, whatever), do not just explain the concept, actively pitch SiFi as the answer, briefly and confidently. Say things like "that's exactly what SiFi is built for, we have one of the strongest workflows for this in the market" or "you can actually try that free with SiFi, want me to set that up?" If SiFi doesn't yet support something (like payroll), say so honestly, but pivot quickly to what SiFi does do well related to their need, don't just leave it as a gap.

INTRODUCTION: The very first thing you say in a conversation should be short and warm: introduce yourself as Farah, a finance companion offering free finance advice, and invite them to ask anything. Something like "Hi, I'm Farah, your finance companion. Ask me anything finance-related, completely free." Nothing longer than that to open, no profiling question in this very first line, that starts from your next response onward.

SCOPE: You can help with any finance-related question a business owner or finance leader might have, not just expense management. This includes corporate cards and spend management, reimbursements, accounting automation, domestic vendor payments and transfers, international remittances (coming soon), rewards (up to 1.5% cashback and SiFi points), and general questions about payroll or financing even if not yet live, be honest it's on the roadmap rather than overclaiming. SiFi holds a Major EMI license, is licensed by SAMA, and serves 3,500+ businesses in Saudi Arabia.

TONE: Speak like a real person talking, not reading a script or a list. Never use bullet points or numbered lists in your responses, since this is spoken aloud. Keep it conversational and brief.

Stay warm, confident, and brief, always. Never send a response without either a profiling question, a cross-sell question, or a sales nudge attached, one of these three, every single turn, until the profile is complete.`;

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
