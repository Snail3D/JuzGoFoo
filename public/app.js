// WebSocket connection
const ws = new WebSocket('ws://localhost:3001');

// Speech recognition setup
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = new SpeechRecognition();

recognition.continuous = false;
recognition.interimResults = false;
recognition.lang = 'en-US';

let isListening = false;
const chatContainer = document.getElementById('chatContainer');
const messageInput = document.getElementById('messageInput');
const voiceButton = document.getElementById('voiceButton');
const micIndicator = document.getElementById('mic-indicator');
const statusText = document.getElementById('status');

// Chat history
let messages = [];

// WebSocket event handlers
ws.onopen = () => {
  console.log('Connected to server');
  updateStatus('Connected');
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);

  if (data.type === 'command') {
    handleCommand(data.action, data.original);
  } else if (data.type === 'message') {
    addMessage('assistant', data.response);
  }
};

ws.onerror = (error) => {
  console.error('WebSocket error:', error);
  updateStatus('Connection error');
};

ws.onclose = () => {
  updateStatus('Disconnected');
};

// Voice recognition handlers
recognition.onstart = () => {
  isListening = true;
  voiceButton.classList.add('listening');
  voiceButton.textContent = '🔴 Listening...';
  micIndicator.classList.remove('mic-off');
  micIndicator.classList.add('mic-on');
  updateStatus('Listening...');
  messageInput.value = '';
};

recognition.onresult = (event) => {
  const transcript = event.results[0][0].transcript;
  messageInput.value = transcript;
  sendMessage(transcript);
};

recognition.onerror = (event) => {
  console.error('Speech recognition error:', event.error);
  updateStatus(`Error: ${event.error}`);
  stopListening();
};

recognition.onend = () => {
  stopListening();
};

// Functions
function toggleVoice() {
  if (isListening) {
    recognition.stop();
  } else {
    recognition.start();
  }
}

function stopListening() {
  isListening = false;
  voiceButton.classList.remove('listening');
  voiceButton.textContent = '🎤 Speak';
  micIndicator.classList.remove('mic-on');
  micIndicator.classList.add('mic-off');
  updateStatus('Ready');
}

function sendMessage(text) {
  if (!text.trim()) return;

  addMessage('user', text);

  ws.send(JSON.stringify({
    type: 'voice_input',
    text: text
  }));
}

function addMessage(role, content) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${role}`;
  messageDiv.textContent = content;
  chatContainer.appendChild(messageDiv);
  chatContainer.scrollTop = chatContainer.scrollHeight;

  messages.push({ role, content, timestamp: new Date() });
}

function handleCommand(action, original) {
  addMessage('command', `Command: ${original}`);

  switch (action) {
    case 'reset':
      clearChat();
      break;
    case 'save':
      saveChat();
      break;
    case 'compact':
      compactView();
      break;
    case 'scroll':
      // Handle scroll commands
      if (original.includes('top')) {
        chatContainer.scrollTop = 0;
      } else if (original.includes('bottom')) {
        chatContainer.scrollTop = chatContainer.scrollHeight;
      }
      break;
    case 'copy':
      copyLastMessage();
      break;
  }
}

function clearChat() {
  if (confirm('Clear all messages?')) {
    chatContainer.innerHTML = '';
    messages = [];
    addMessage('command', 'Chat cleared');
  }
}

function saveChat() {
  const chatText = messages.map(m =>
    `[${m.timestamp.toLocaleTimeString()}] ${m.role.toUpperCase()}: ${m.content}`
  ).join('\n\n');

  const blob = new Blob([chatText], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `chat-${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);

  addMessage('command', 'Chat saved');
}

function compactView() {
  document.querySelector('.container').classList.toggle('compact-view');
  addMessage('command', 'Toggled compact view');
}

function copyLastMessage() {
  const lastAssistantMsg = messages.filter(m => m.role === 'assistant').pop();
  if (lastAssistantMsg) {
    navigator.clipboard.writeText(lastAssistantMsg.content);
    addMessage('command', 'Copied last response');
  }
}

function updateStatus(text) {
  statusText.textContent = text;
}

// Auto-focus on load
window.addEventListener('load', () => {
  messageInput.focus();
  addMessage('assistant', 'Hi! Double-click anywhere in the input field to start speaking, or click the microphone button. Try saying "reset", "save chat", or "compact this" to control the interface!');
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  // Cmd + Shift + Space to toggle voice
  if (e.metaKey && e.shiftKey && e.code === 'Space') {
    e.preventDefault();
    toggleVoice();
  }
});
