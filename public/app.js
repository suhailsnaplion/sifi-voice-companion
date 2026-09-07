// SiFi Voice Companion — frontend logic
// Uses the browser's free, built-in Web Speech API for both speech-to-text
// (SpeechRecognition) and text-to-speech (SpeechSynthesis), so there is no
// per-message cost for voice, only the OpenAI text generation call on the backend.

const conversationId = 'conv_' + Math.random().toString(36).slice(2) + '_' + Date.now();
let history = [];
let isRecording = false;
let recognition = null;

const voiceToggle = document.getElementById('voice-toggle');
const voiceWidget = document.getElementById('voice-widget');
const voicePanel = document.getElementById('voice-panel');
const voiceClose = document.getElementById('voice-close');
const voiceStatus = document.getElementById('voice-status');
const transcriptEl = document.getElementById('voice-transcript');
const micBtn = document.getElementById('mic-btn');
const voiceHint = document.getElementById('voice-hint');
const textInput = document.getElementById('text-input');
const textSend = document.getElementById('text-send');

voiceToggle.addEventListener('click', () => {
  voiceWidget.classList.add('hidden');
  voicePanel.classList.remove('hidden');
});

voiceClose.addEventListener('click', () => {
  voicePanel.classList.add('hidden');
  voiceWidget.classList.remove('hidden');
  window.speechSynthesis.cancel();
  if (recognition && isRecording) recognition.stop();
});

function addMessage(role, text) {
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.textContent = text;
  transcriptEl.appendChild(div);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

function speak(text) {
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.0;
  utterance.pitch = 1.0;
  // Try to pick a natural-sounding English voice if available
  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find(
    (v) => v.name.includes('Google US English') || v.name.includes('Samantha') || v.lang === 'en-US'
  );
  if (preferred) utterance.voice = preferred;
  utterance.onstart = () => (voiceStatus.textContent = 'Speaking...');
  utterance.onend = () => (voiceStatus.textContent = 'Tap the mic to talk');
  window.speechSynthesis.speak(utterance);
}

async function sendToAssistant(userText) {
  addMessage('user', userText);
  history.push({ role: 'user', content: userText });
  voiceStatus.textContent = 'Thinking...';

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId, history }),
    });
    const data = await res.json();
    if (data.error) {
      addMessage('assistant', 'Sorry, something went wrong: ' + data.error);
      voiceStatus.textContent = 'Tap the mic to talk';
      return;
    }
    addMessage('assistant', data.reply);
    history.push({ role: 'assistant', content: data.reply });
    speak(data.reply);
  } catch (err) {
    addMessage('assistant', 'Sorry, I had trouble connecting. Please try again.');
    voiceStatus.textContent = 'Tap the mic to talk';
  }
}

// --- Speech recognition setup ---
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    isRecording = true;
    micBtn.classList.add('recording');
    voiceHint.textContent = 'Listening... click again to stop';
    voiceStatus.textContent = 'Listening...';
  };

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    sendToAssistant(transcript);
  };

  recognition.onerror = (event) => {
    voiceStatus.textContent = 'Mic error, try again or type below';
  };

  recognition.onend = () => {
    isRecording = false;
    micBtn.classList.remove('recording');
    voiceHint.textContent = 'Click the mic and speak';
  };
} else {
  voiceHint.textContent = 'Voice not supported in this browser, please type below';
  micBtn.disabled = true;
}

micBtn.addEventListener('click', () => {
  if (!recognition) return;
  if (isRecording) {
    recognition.stop();
  } else {
    window.speechSynthesis.cancel();
    recognition.start();
  }
});

// Text fallback
textSend.addEventListener('click', () => {
  const val = textInput.value.trim();
  if (!val) return;
  textInput.value = '';
  sendToAssistant(val);
});
textInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') textSend.click();
});
