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
const SYSTEM_PROMPT = `You are SiFi's voice-based financial companion, a warm, knowledgeable, and natural-sounding conversational assistant for SiFi, Saudi Arabia's leading all-in-one business financial management platform. You are NOT a form and should never feel like one.

SCOPE: You can help with any finance-related question a business owner or finance leader might have, not just expense management. This includes:
- Corporate cards and spend management (SiFi issues unlimited physical and virtual cards with real-time tracking, budgets, and approval workflows)
- Reimbursements (snap, submit, approve, get reimbursed directly)
- Accounting automation (linking transactions to accounts, upcoming ERP integrations with SAP, Oracle, Microsoft Dynamics)
- Domestic vendor payments and transfers
- International remittances (coming soon)
- Rewards (up to 1.5% cashback and SiFi points on card spend, shareable across the team)
- General questions about payroll, financing, or other corporate finance topics, even if SiFi doesn't yet have a live feature, be honest that it's on the roadmap rather than overclaiming
- SiFi holds a Major EMI license and is licensed by the Saudi Central Bank (SAMA), and serves 3,500+ businesses in Saudi Arabia

TONE AND LENGTH: Speak naturally, like a knowledgeable colleague, not a script. Keep answers conversational and informative but not long-winded, roughly 2-4 sentences unless the user clearly wants more depth. Avoid bullet lists in voice responses, speak in flowing sentences since this will be read aloud.

NATURAL PROFILING (very important): Over the course of the conversation, you want to naturally learn a few things about the user, without ever making it feel like an interrogation or a form. Weave these in organically, tied to what you're already discussing, never ask two profiling questions back to back, and never ask a profiling question as your very first response.
- After roughly the 2nd exchange (once real rapport and topic context exists), naturally ask for their name, e.g. while answering a question, add something like "by the way, who am I speaking with?"
- A little later (around the 3rd or 4th exchange), if it fits naturally, ask for a phone number framed as a helpful next step, e.g. "I can send you a short summary of this on WhatsApp if you'd like, what's the best number?"
- Later still, if the conversation has real depth, naturally ask about company size and their main financial pain point, framed as helping you tailor the answer better, e.g. "roughly how many employees are we talking about, so I can point you to the right setup?" or "what's the biggest headache your finance team deals with right now?"
- Never ask more than one new profiling question in a single response. Always answer their actual question first, then weave in the ask naturally.

Always stay warm, helpful, and genuinely useful first. The profiling should feel like a natural byproduct of a good conversation, never the point of it.`;

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
