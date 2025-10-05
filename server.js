const express = require('express');
const WebSocket = require('ws');
const bodyParser = require('body-parser');
const path = require('path');
const fetch = require('node-fetch');
const multer = require('multer');
const fs = require('fs');

const app = express();
const PORT = 3000;

// Conversation history for context
const conversationHistory = [];

// Set up multer for audio file uploads
const upload = multer({ dest: 'uploads/' });

app.use(bodyParser.json());
app.use(express.static('public'));

// Command interpreter - detects meta-commands from voice input
function interpretCommand(input) {
  const lowerInput = input.toLowerCase().trim();

  // Meta-commands that control the interface
  const commands = {
    reset: /^(reset|clear|start over|new conversation)/i,
    save: /^(save|export|download) (this )?chat/i,
    compact: /^(compact|summarize|condense) (this|the chat)/i,
    scroll: /^scroll (up|down|to (top|bottom))/i,
    copy: /^copy (last|previous) (response|message)/i,
  };

  for (const [action, pattern] of Object.entries(commands)) {
    if (pattern.test(lowerInput)) {
      return { isCommand: true, action, original: input };
    }
  }

  return { isCommand: false, message: input };
}

// Call Ollama LLM
async function callLLM(userMessage) {
  // Add user message to history
  conversationHistory.push({ role: 'user', content: userMessage });

  // Build context from last 10 messages
  const context = conversationHistory.slice(-10).map(msg =>
    `${msg.role}: ${msg.content}`
  ).join('\n');

  const prompt = `${context}\nassistant:`;

  try {
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3.2',
        prompt: prompt,
        stream: false,
        options: { num_predict: 500 }
      })
    });

    const data = await response.json();
    const assistantMessage = data.response.trim();

    // Add assistant response to history
    conversationHistory.push({ role: 'assistant', content: assistantMessage });

    return assistantMessage;
  } catch (error) {
    console.error('Ollama error:', error);
    throw error;
  }
}

// WebSocket server for real-time communication
const wss = new WebSocket.Server({ port: 3001 });

wss.on('connection', (ws) => {
  console.log('Client connected');

  ws.on('message', async (message) => {
    const data = JSON.parse(message);

    if (data.type === 'voice_input') {
      const interpreted = interpretCommand(data.text);

      if (interpreted.isCommand) {
        // Send command back to client for UI control
        ws.send(JSON.stringify({
          type: 'command',
          action: interpreted.action,
          original: interpreted.original
        }));
      } else {
        // Regular message - process with LLM
        try {
          const response = await callLLM(interpreted.message);
          ws.send(JSON.stringify({
            type: 'message',
            text: interpreted.message,
            response: response
          }));
        } catch (error) {
          console.error('LLM call failed:', error);
          ws.send(JSON.stringify({
            type: 'message',
            text: interpreted.message,
            response: 'Sorry, I encountered an error processing your message.'
          }));
        }
      }
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Transcription endpoint for cross-platform audio
app.post('/transcribe', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    // For now, return a placeholder - you can integrate Whisper API here
    // Options: OpenAI Whisper API, Groq Whisper, or local Whisper.cpp
    console.log('Received audio for transcription:', req.file.path);

    // Clean up the uploaded file
    fs.unlinkSync(req.file.path);

    // Placeholder response - integrate real transcription service
    res.json({
      text: 'Cross-platform transcription coming soon - use Chrome for Web Speech API',
      method: 'mediarecorder'
    });

  } catch (error) {
    console.error('Transcription error:', error);
    res.status(500).json({ error: 'Transcription failed' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`WebSocket server running on port 3001`);
  console.log(`\nPlatform Compatibility:`);
  console.log(`  - Chrome/Edge: Full support (Web Speech API)`);
  console.log(`  - Firefox/Safari: MediaRecorder fallback`);
  console.log(`  - Raspberry Pi: Use Chrome/Chromium for best results`);
});
