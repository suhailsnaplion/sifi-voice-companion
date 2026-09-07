// SiFi Voice Companion (Farah) — continuous conversation, tap-to-interrupt
//
// IMPORTANT DESIGN NOTE: true "listen while speaking" barge-in was removed.
// On a normal laptop, the microphone picks up Farah's own voice coming out
// of the speakers and mishears it as user input (audio feedback), this is a
// well-known limitation of browser-based mic + speaker setups without
// dedicated echo-cancelling hardware or a proper server-side audio pipeline
// (the kind of setup services like LiveKit/Pipecat exist to solve).
// Instead: tap anywhere on Farah's avatar to interrupt her instantly, and a
// lightweight echo-guard ignores anything picked up right after she speaks
// that closely matches her own last sentence, as a safety net.

const conversationId = 'conv_' + Math.random().toString(36).slice(2) + '_' + Date.now();
let history = [];
let currentAudio = null;
let recognition = null;
let isListening = false;
let isSpeaking = false;
let conversationActive = false;
let lastAssistantText = '';

const voiceToggle = document.getElementById('voice-toggle');
const voiceWidget = document.getElementById('voice-widget');
const voicePanel = document.getElementById('voice-panel');
const voiceClose = document.getElementById('voice-close');
const voiceStatus = document.getElementById('voice-status');
const transcriptEl = document.getElementById('voice-transcript');
const textInput = document.getElementById('text-input');
const textSend = document.getElementById('text-send');
const speakingRing = document.getElementById('speaking-ring');
const listeningRing = document.getElementById('listening-ring');
const avatarLarge = document.getElementById('companion-avatar-large');

function setState(state, label) {
  speakingRing.classList.remove('active');
  listeningRing.classList.remove('active');
  if (state === 'listening') listeningRing.classList.add('active');
  if (state === 'speaking') speakingRing.classList.add('active');
  voiceStatus.textContent = label;
}

voiceToggle.addEventListener('click', () => {
  voiceWidget.classList.add('hidden');
  voicePanel.classList.remove('hidden');
  startConversation();
});

voiceClose.addEventListener('click', () => {
  voicePanel.classList.add('hidden');
  voiceWidget.classList.remove('hidden');
  stopEverything();
});

// Tap Farah's avatar to interrupt her while she's speaking, this is the
// interruption mechanism, safer than simultaneous mic listening.
avatarLarge.addEventListener('click', () => {
  if (isSpeaking) {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }
    window.speechSynthesis.cancel();
    isSpeaking = false;
    startNormalListening();
  }
});

function stopEverything() {
  conversationActive = false;
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  window.speechSynthesis.cancel();
  if (recognition) {
    recognition.onend = null;
    try { recognition.stop(); } catch (e) {}
  }
  isListening = false;
  isSpeaking = false;
}

function addMessage(role, text) {
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.textContent = text;
  transcriptEl.appendChild(div);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

// Simple word-overlap similarity check, used to catch cases where the mic
// still picks up a faint echo of Farah's own voice right after she finishes.
function isLikelyEcho(heard, spoken) {
  if (!spoken) return false;
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
  const heardWords = new Set(norm(heard));
  const spokenWords = new Set(norm(spoken));
  if (heardWords.size === 0) return false;
  let overlap = 0;
  heardWords.forEach((w) => { if (spokenWords.has(w)) overlap++; });
  const ratio = overlap / heardWords.size;
  return ratio > 0.55; // more than half the heard words came from Farah's own last line
}

async function startConversation() {
  if (conversationActive) return;
  conversationActive = true;
  setState('thinking', 'Getting ready...');
  try {
    const res = await fetch('/api/intro');
    const data = await res.json();
    addMessage('assistant', data.text);
    history.push({ role: 'assistant', content: data.text });
    lastAssistantText = data.text;
    await speakThenListen(data.text);
  } catch (err) {
    setState('idle', "Couldn't connect, try typing instead");
  }
}

// Speaks the text, and only once playback genuinely finishes, starts
// listening again automatically, no click needed for normal turns.
async function speakThenListen(text) {
  isSpeaking = true;
  setState('speaking', 'Speaking... tap to interrupt');

  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const data = await res.json();

    if (data.error || !data.audio) {
      speakWithBrowserFallback(text);
      return;
    }

    const audioSrc = 'data:audio/wav;base64,' + data.audio;
    currentAudio = new Audio(audioSrc);
    currentAudio.onended = onSpeakingFinished;
    currentAudio.onerror = () => speakWithBrowserFallback(text);
    await currentAudio.play();
  } catch (err) {
    speakWithBrowserFallback(text);
  }
}

function onSpeakingFinished() {
  isSpeaking = false;
  currentAudio = null;
  if (!conversationActive) return;
  // Small delay before listening starts, gives any speaker/room echo time to
  // die down before the mic starts capturing, extra protection against echo.
  setTimeout(() => {
    if (conversationActive && !isSpeaking) startNormalListening();
  }, 400);
}

function speakWithBrowserFallback(text) {
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find((v) => v.lang === 'en-US');
  if (preferred) utterance.voice = preferred;
  utterance.onend = onSpeakingFinished;
  window.speechSynthesis.speak(utterance);
}

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognitionSupported = !!SpeechRecognition;

if (recognitionSupported) {
  recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onresult = (event) => {
    const transcript = event.results[event.results.length - 1][0].transcript;
    if (!transcript || !transcript.trim()) return;

    // Echo guard: if this sounds like Farah's own last line leaking through
    // the mic, quietly ignore it and keep listening.
    if (isLikelyEcho(transcript, lastAssistantText)) {
      console.log('Ignored likely echo:', transcript);
      return;
    }

    isListening = false;
    sendToAssistant(transcript);
  };

  recognition.onerror = (event) => {
    if (event.error !== 'no-speech' && event.error !== 'aborted') {
      console.warn('Recognition error:', event.error);
    }
  };

  recognition.onend = () => {
    isListening = false;
    if (conversationActive && !isSpeaking) {
      setTimeout(() => {
        if (conversationActive && !isListening && !isSpeaking) {
          startNormalListening();
        }
      }, 300);
    }
  };
} else {
  recognitionSupported = false;
}

function startNormalListening() {
  if (!recognitionSupported || isListening || isSpeaking) return;
  try {
    isListening = true;
    setState('listening', "I'm listening...");
    recognition.start();
  } catch (e) {
    isListening = false;
  }
}

async function sendToAssistant(userText) {
  addMessage('user', userText);
  history.push({ role: 'user', content: userText });
  setState('thinking', 'Thinking...');

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId, history }),
    });
    const data = await res.json();
    if (data.error) {
      addMessage('assistant', 'Sorry, something went wrong.');
      setState('idle', 'Something went wrong');
      return;
    }
    addMessage('assistant', data.reply);
    history.push({ role: 'assistant', content: data.reply });
    lastAssistantText = data.reply;
    await speakThenListen(data.reply);
  } catch (err) {
    setState('idle', 'Connection issue, try again');
  }
}

textSend.addEventListener('click', () => {
  const val = textInput.value.trim();
  if (!val) return;
  textInput.value = '';
  if (isSpeaking && currentAudio) {
    currentAudio.pause();
    currentAudio = null;
    isSpeaking = false;
  }
  sendToAssistant(val);
});
textInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') textSend.click();
});
