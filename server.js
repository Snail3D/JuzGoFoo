const express = require('express');
const WebSocket = require('ws');
const bodyParser = require('body-parser');
const path = require('path');
const { exec } = require('child_process');

const app = express();
const PORT = 3000;

// Conversation history for context
const conversationHistory = [];

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
  return new Promise((resolve, reject) => {
    // Add user message to history
    conversationHistory.push({ role: 'user', content: userMessage });

    // Build context from last 10 messages
    const context = conversationHistory.slice(-10).map(msg =>
      `${msg.role}: ${msg.content}`
    ).join('\n');

    const prompt = `${context}\nassistant:`;

    const ollamaCommand = `curl -s http://localhost:11434/api/generate -d '{
      "model": "llama3.2",
      "prompt": ${JSON.stringify(prompt)},
      "stream": false,
      "options": {"num_predict": 500}
    }'`;

    exec(ollamaCommand, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
      if (error) {
        console.error('Ollama error:', error);
        reject(error);
        return;
      }

      try {
        const response = JSON.parse(stdout);
        const assistantMessage = response.response.trim();

        // Add assistant response to history
        conversationHistory.push({ role: 'assistant', content: assistantMessage });

        resolve(assistantMessage);
      } catch (e) {
        console.error('Parse error:', e);
        reject(e);
      }
    });
  });
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

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`WebSocket server running on port 3001`);
});
