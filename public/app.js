// WebSocket connection
const ws = new WebSocket('ws://localhost:3001');

// Speech recognition setup - try Web Speech API first
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let wakeWordRecognition = null;
let useWebSpeech = false;
let mediaRecorder = null;
let audioChunks = [];

// Check if Web Speech API is available
if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = 'en-US';
  
  wakeWordRecognition = new SpeechRecognition();
  wakeWordRecognition.continuous = true;
  wakeWordRecognition.interimResults = true;
  wakeWordRecognition.lang = 'en-US';
  
  useWebSpeech = true;
  console.log('Using Web Speech API');
} else {
  console.log('Using MediaRecorder + server-side transcription');
}

let isListening = false;
let wakeWordEnabled = false;
let conversationalMode = false;
let isWaitingForCommand = false;
let wakeWordRestartTimeout = null;
let autoListenTimeout = null;

const chatContainer = document.getElementById('chatContainer');
const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');
const micIndicator = document.getElementById('mic-indicator');
const statusText = document.getElementById('status');
const wakeWordToggle = document.getElementById('wakeWordToggle');
const conversationalToggle = document.getElementById('conversationalToggle');

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
    
    // In conversational mode, automatically start listening after response
    if (conversationalMode) {
      clearTimeout(autoListenTimeout);
      autoListenTimeout = setTimeout(() => {
        console.log('Conversational mode: auto-starting listening');
        startCommandListening();
      }, 1000); // Wait 1 second after response
    }
  }
};

ws.onerror = (error) => {
  console.error('WebSocket error:', error);
  updateStatus('Connection error');
};

ws.onclose = () => {
  updateStatus('Disconnected');
};

// Wake word recognition
if (useWebSpeech) {
  wakeWordRecognition.onresult = (event) => {
    const results = event.results;
    
    // Check all results, not just the last one
    for (let i = 0; i < results.length; i++) {
      const transcript = results[i][0].transcript.toLowerCase().trim();
      console.log('Wake word listener heard:', transcript);
      
      // More flexible wake word detection
      if (transcript.includes('hey foo') || 
          transcript.includes('hey fu') ||
          transcript.includes('a foo') ||
          transcript.includes('hey food') ||
          transcript.includes('hay foo')) {
        console.log('✓ Wake word detected! Starting command listening...');
        
        // Visual feedback
        micIndicator.style.backgroundColor = '#00ff00';
        setTimeout(() => {
          micIndicator.style.backgroundColor = '';
        }, 300);
        
        startCommandListening();
        break;
      }
    }
  };

  wakeWordRecognition.onerror = (event) => {
    console.error('Wake word recognition error:', event.error);
    
    // Don't restart on aborted errors (those are intentional stops)
    if (event.error === 'aborted') {
      return;
    }
    
    if (wakeWordEnabled && !isWaitingForCommand && !conversationalMode) {
      console.log('Restarting wake word recognition after error...');
      clearTimeout(wakeWordRestartTimeout);
      wakeWordRestartTimeout = setTimeout(() => {
        try {
          wakeWordRecognition.start();
          console.log('Wake word recognition restarted');
        } catch (e) {
          console.log('Could not restart:', e.message);
        }
      }, 1000);
    }
  };

  wakeWordRecognition.onend = () => {
    console.log('Wake word recognition ended');
    
    if (wakeWordEnabled && !isWaitingForCommand && !conversationalMode) {
      console.log('Restarting wake word recognition...');
      clearTimeout(wakeWordRestartTimeout);
      wakeWordRestartTimeout = setTimeout(() => {
        try {
          wakeWordRecognition.start();
          console.log('Wake word recognition restarted');
        } catch (e) {
          console.log('Could not restart:', e.message);
        }
      }, 100);
    }
  };

  wakeWordRecognition.onstart = () => {
    console.log('Wake word recognition started - say "Hey Foo"');
  };

  // Command recognition (after wake word)
  recognition.onstart = () => {
    isListening = true;
    isWaitingForCommand = true;
    micIndicator.classList.remove('mic-off');
    micIndicator.classList.add('mic-on');
    updateStatus('Listening...');
    messageInput.placeholder = 'Listening...';
    console.log('Command recognition started');
  };

  recognition.onresult = (event) => {
    const results = event.results;
    const lastResult = results[results.length - 1];

    if (lastResult.isFinal) {
      const transcript = lastResult[0].transcript;
      console.log('Final command:', transcript);
      messageInput.value = transcript;
      sendMessage(transcript);
      stopCommandListening();
    } else {
      // Show interim results
      const interim = lastResult[0].transcript;
      messageInput.value = interim + '...';
    }
  };

  recognition.onerror = (event) => {
    console.error('Speech recognition error:', event.error);
    stopCommandListening();
  };

  recognition.onend = () => {
    console.log('Command recognition ended');
    stopCommandListening();
  };
}

function toggleConversationalMode() {
  conversationalMode = !conversationalMode;
  
  if (conversationalMode) {
    conversationalToggle.textContent = 'Conversational: ON';
    conversationalToggle.style.color = '#ff8800';
    conversationalToggle.style.fontWeight = 'bold';
    
    // Disable wake word mode if it's on
    if (wakeWordEnabled) {
      toggleWakeWord();
    }
    
    // Start listening immediately without announcement
    if (useWebSpeech) {
      setTimeout(() => {
        startCommandListening();
      }, 500);
    } else {
      alert('Web Speech API not supported. Please use Chrome or Edge browser.');
    }
  } else {
    conversationalToggle.textContent = 'Conversational: OFF';
    conversationalToggle.style.color = '#00cc00';
    conversationalToggle.style.fontWeight = 'normal';
    
    // Stop any pending auto-listen
    clearTimeout(autoListenTimeout);
    
    // Stop listening if active
    if (isListening) {
      try {
        recognition.stop();
      } catch (e) {
        console.log('Could not stop recognition');
      }
    }
    
    stopCommandListening();
  }
}

function toggleWakeWord() {
  wakeWordEnabled = !wakeWordEnabled;
  
  if (wakeWordEnabled) {
    // Disable conversational mode if it's on
    if (conversationalMode) {
      toggleConversationalMode();
    }
    
    wakeWordToggle.textContent = 'Wake Word: ON';
    wakeWordToggle.style.color = '#00ff00';
    micIndicator.style.opacity = '0.6';
    updateStatus('Listening for "Hey Foo"...');
    
    if (useWebSpeech) {
      try {
        wakeWordRecognition.start();
        console.log('Wake word detection enabled');
      } catch (e) {
        console.log('Wake word recognition already running:', e.message);
      }
    } else {
      alert('Web Speech API not supported. Please use Chrome or Edge browser.');
    }
  } else {
    wakeWordToggle.textContent = 'Wake Word: OFF';
    wakeWordToggle.style.color = '#00cc00';
    micIndicator.style.opacity = '0.3';
    updateStatus('Ready');
    
    if (useWebSpeech) {
      try {
        wakeWordRecognition.stop();
        console.log('Wake word detection disabled');
      } catch (e) {
        console.log('Wake word recognition not running');
      }
    }
    
    clearTimeout(wakeWordRestartTimeout);
  }
}

function startCommandListening() {
  if (isWaitingForCommand) {
    console.log('Already waiting for command, ignoring...');
    return;
  }
  
  // Stop wake word recognition temporarily (only if not in conversational mode)
  if (wakeWordEnabled && !conversationalMode) {
    try {
      wakeWordRecognition.stop();
    } catch (e) {
      console.log('Could not stop wake word recognition');
    }
  }
  
  try {
    recognition.start();
  } catch (e) {
    console.log('Recognition already started:', e.message);
  }
}

function stopCommandListening() {
  isListening = false;
  isWaitingForCommand = false;
  micIndicator.classList.remove('mic-on');
  micIndicator.classList.add('mic-off');
  
  if (conversationalMode) {
    messageInput.placeholder = 'Type or speak...';
    updateStatus('Ready');
  } else if (wakeWordEnabled) {
    messageInput.placeholder = 'Type or say "Hey Foo" to speak...';
    updateStatus('Listening for "Hey Foo"...');
    
    // Restart wake word recognition
    setTimeout(() => {
      if (wakeWordEnabled && !isWaitingForCommand) {
        try {
          wakeWordRecognition.start();
          console.log('Wake word recognition resumed');
        } catch (e) {
          console.log('Could not resume wake word recognition:', e.message);
        }
      }
    }, 500);
  } else {
    messageInput.placeholder = 'Type or press Enter to speak...';
    updateStatus('Ready');
  }
}

function sendMessage(text) {
  const message = text || messageInput.value;
  if (!message.trim()) return;

  addMessage('user', message);
  messageInput.value = '';

  ws.send(JSON.stringify({
    type: 'voice_input',
    text: message
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
  // Don't show command popup anymore

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
  addMessage('assistant', 'Hi! You can type messages anytime. Click "Wake Word: OFF" for wake word mode, or "Conversational: OFF" for continuous listening mode!');
  
  // Check for microphone permissions
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(() => {
        console.log('✓ Microphone access granted');
        addMessage('assistant', '✓ Microphone ready. Choose your mode: Wake Word (say "Hey Foo" each time) or Conversational (continuous listening).');
      })
      .catch((err) => {
        console.error('✗ Microphone access denied:', err);
        addMessage('assistant', '⚠️ Please allow microphone access for voice control to work.');
      });
  }
});

// Enter key to send message
messageInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    sendMessage();
  }
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  // Cmd + Shift + W to toggle wake word
  if (e.metaKey && e.shiftKey && e.code === 'KeyW') {
    e.preventDefault();
    toggleWakeWord();
  }
  
  // Cmd + Shift + C to toggle conversational mode
  if (e.metaKey && e.shiftKey && e.code === 'KeyC') {
    e.preventDefault();
    toggleConversationalMode();
  }
});
