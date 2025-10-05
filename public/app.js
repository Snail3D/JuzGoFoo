// WebSocket connection
const ws = new WebSocket('ws://localhost:3001');

// Speech recognition setup - try Web Speech API first
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let useWebSpeech = false;
let mediaRecorder = null;
let audioChunks = [];

// Check if Web Speech API is available
if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';
  useWebSpeech = true;
  console.log('Using Web Speech API');
} else {
  console.log('Using MediaRecorder + server-side transcription');
}

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
  } else if (data.type === 'tool_execution') {
    addMessage('tool', `🔧 Executing: ${data.tool}(${JSON.stringify(data.input)})`);
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

// Voice recognition handlers - only set if using Web Speech API
if (useWebSpeech) {
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
    const results = event.results;
    const lastResult = results[results.length - 1];

    if (lastResult.isFinal) {
      const transcript = lastResult[0].transcript;
      messageInput.value = transcript;
      sendMessage(transcript);
    } else {
      // Show interim results
      const interim = lastResult[0].transcript;
      messageInput.value = interim + '...';
    }
  };

  recognition.onerror = (event) => {
    console.error('Speech recognition error:', event.error);
    updateStatus(`Error: ${event.error}`);
    stopListening();
  };

  recognition.onend = () => {
    // Auto-restart if still in listening mode
    if (isListening) {
      recognition.start();
    }
  };
}

// Functions
async function toggleVoice() {
  if (isListening) {
    stopListening();
  } else {
    if (useWebSpeech) {
      recognition.start();
    } else {
      await startMediaRecorder();
    }
  }
}

async function startMediaRecorder() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    audioChunks = [];

    mediaRecorder.ondataavailable = (event) => {
      audioChunks.push(event.data);
    };

    mediaRecorder.onstop = async () => {
      const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
      const formData = new FormData();
      formData.append('audio', audioBlob);

      // Send to server for transcription
      const response = await fetch('/transcribe', {
        method: 'POST',
        body: formData
      });

      const result = await response.json();
      if (result.text) {
        messageInput.value = result.text;
        sendMessage(result.text);
      }

      // Restart if still listening
      if (isListening) {
        setTimeout(() => startMediaRecorder(), 100);
      }
    };

    mediaRecorder.start();

    // Stop after 5 seconds to process, then restart
    setTimeout(() => {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
      }
    }, 5000);

    isListening = true;
    voiceButton.classList.add('listening');
    voiceButton.textContent = '🔴 Listening...';
    micIndicator.classList.remove('mic-off');
    micIndicator.classList.add('mic-on');
    updateStatus('Listening...');
    messageInput.value = '';

  } catch (error) {
    console.error('Microphone access error:', error);
    updateStatus('Microphone access denied');
  }
}

function stopListening() {
  isListening = false;

  if (useWebSpeech && recognition) {
    recognition.stop();
  } else if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    mediaRecorder.stream.getTracks().forEach(track => track.stop());
  }

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
