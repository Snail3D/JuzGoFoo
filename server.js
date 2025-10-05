const express = require('express');
const WebSocket = require('ws');
const bodyParser = require('body-parser');
const path = require('path');
const fetch = require('node-fetch');
const multer = require('multer');
const fs = require('fs');
const { exec } = require('child_process');
const { promisify } = require('util');
const Anthropic = require('@anthropic-ai/sdk');
require('dotenv').config();

const execAsync = promisify(exec);

const app = express();
const PORT = 3000;

// Initialize Claude API
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || 'PLEASE_SET_YOUR_API_KEY'
});

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

// Tool definitions
const tools = [
  {
    name: "read_file",
    description: "Read the contents of a file",
    input_schema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "The absolute path to the file to read"
        }
      },
      required: ["file_path"]
    }
  },
  {
    name: "write_file",
    description: "Write content to a file",
    input_schema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "The absolute path to the file to write"
        },
        content: {
          type: "string",
          description: "The content to write to the file"
        }
      },
      required: ["file_path", "content"]
    }
  },
  {
    name: "execute_bash",
    description: "Execute a bash command and return the output",
    input_schema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The bash command to execute"
        }
      },
      required: ["command"]
    }
  },
  {
    name: "list_files",
    description: "List files in a directory",
    input_schema: {
      type: "object",
      properties: {
        directory: {
          type: "string",
          description: "The directory path to list files from"
        }
      },
      required: ["directory"]
    }
  }
];

// Tool execution functions
async function executeTool(toolName, toolInput) {
  switch (toolName) {
    case 'read_file':
      try {
        const content = fs.readFileSync(toolInput.file_path, 'utf8');
        return { success: true, content };
      } catch (error) {
        return { success: false, error: error.message };
      }

    case 'write_file':
      try {
        fs.writeFileSync(toolInput.file_path, toolInput.content, 'utf8');
        return { success: true, message: 'File written successfully' };
      } catch (error) {
        return { success: false, error: error.message };
      }

    case 'execute_bash':
      try {
        const { stdout, stderr } = await execAsync(toolInput.command);
        return { success: true, stdout, stderr };
      } catch (error) {
        return { success: false, error: error.message, stderr: error.stderr };
      }

    case 'list_files':
      try {
        const files = fs.readdirSync(toolInput.directory);
        return { success: true, files };
      } catch (error) {
        return { success: false, error: error.message };
      }

    default:
      return { success: false, error: 'Unknown tool' };
  }
}

// Call Claude API with tool support
async function callLLM(userMessage, ws) {
  // Add user message to history
  conversationHistory.push({ role: 'user', content: userMessage });

  try {
    let continueLoop = true;
    let fullResponse = '';

    while (continueLoop) {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 4096,
        tools: tools,
        system: `You are Claude Sonnet 4.5, integrated into a voice-controlled terminal interface called JuzGoFoo.

You have access to real tools for:
- Reading files (read_file)
- Writing files (write_file)
- Executing bash commands (execute_bash)
- Listing directory contents (list_files)

When users ask you to do something, USE THE TOOLS to actually do it! You can:
- Create, read, and modify files
- Run system commands
- Search for files
- Execute code

Keep responses concise and conversational since this is a voice interface. When you use tools, briefly explain what you're doing.`,
        messages: conversationHistory.slice(-20) // Last 20 messages for context
      });

      // Check if we need to use tools
      if (response.stop_reason === 'tool_use') {
        const toolUses = response.content.filter(block => block.type === 'tool_use');

        // Add assistant response with tool uses ONCE
        conversationHistory.push({
          role: 'assistant',
          content: response.content
        });

        // Execute each tool and collect results
        const toolResults = [];
        for (const toolUse of toolUses) {
          console.log(`Executing tool: ${toolUse.name}`, toolUse.input);

          // Send tool execution notification to client
          if (ws) {
            ws.send(JSON.stringify({
              type: 'tool_execution',
              tool: toolUse.name,
              input: toolUse.input
            }));
          }

          const result = await executeTool(toolUse.name, toolUse.input);

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify(result)
          });
        }

        // Add all tool results in one user message
        conversationHistory.push({
          role: 'user',
          content: toolResults
        });
      } else {
        // No more tools to use, extract final response
        const textContent = response.content.find(block => block.type === 'text');
        if (textContent) {
          fullResponse = textContent.text;
        }

        conversationHistory.push({
          role: 'assistant',
          content: response.content
        });

        continueLoop = false;
      }
    }

    return fullResponse;
  } catch (error) {
    console.error('Claude API error:', error);

    // Fallback to friendly error message
    if (error.status === 401) {
      return "I need an API key to work! Please set your ANTHROPIC_API_KEY in the .env file. Get one at https://console.anthropic.com/settings/keys";
    }

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
        // Regular message - process with LLM and tools
        try {
          const response = await callLLM(interpreted.message, ws);
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
