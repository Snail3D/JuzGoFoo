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
const NLPHandler = require('./nlp-handler');
const MemoryManager = require('./memory-manager');
const LogCompressor = require('./log-compressor');
const ContextMonitor = require('./context-monitor');
require('dotenv').config();

const execAsync = promisify(exec);

const app = express();
const PORT = 3000;

// Initialize Claude API
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || 'PLEASE_SET_YOUR_API_KEY'
});

// Initialize NLP Handler
const nlpHandler = new NLPHandler();

// Initialize Memory Manager
const memoryManager = new MemoryManager();

// Initialize Log Compressor (saves cloud credits!)
const logCompressor = new LogCompressor({
  compressionThreshold: 10,
  checkInterval: 120000, // check every 2 minutes
  ollamaModel: 'llama2'
});

// Initialize Context Monitor (extracts organized data for Claude)
const contextMonitor = new ContextMonitor({
  ollamaModel: 'mistral', // better for JSON
  messagesBeforeExtract: 3
});

// Conversation history for context
const conversationHistory = [];

// Set up multer for audio file uploads
const upload = multer({ dest: 'uploads/' });

app.use(bodyParser.json());
app.use(express.static('public'));

// Text-to-speech function
async function speak(text) {
  try {
    // Use macOS 'say' command with faster voice and better quality
    await execAsync(`say -v Samantha -r 200 "${text.replace(/"/g, '\\"')}"`);
  } catch (error) {
    console.error('TTS error:', error.message);
  }
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
async function callLLM(userMessage, ws, nlpContext = null) {
  // Clear conversation history to avoid context buildup and rate limits
  conversationHistory.length = 0;

  // Use enhanced prompt if available from NLP processing
  const promptToUse = nlpContext?.enhancedPrompt || userMessage;
  
  // Get persistent memory context
  const memoryContext = memoryManager.getContextPrompt();
  
  // Get extracted context from local LLM monitoring
  const extractedContext = await contextMonitor.getContextForClaude();
  
  // Add NLP metadata to system prompt if intent was detected
  let systemPrompt = `You are Claude Sonnet 4.5, integrated into a voice-controlled terminal interface called JuzGoFoo.

${memoryContext}

${extractedContext}

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

Keep responses SHORT and conversational since this is a VOICE interface. Aim for 1-2 sentences max when possible.`;

  if (nlpContext && nlpContext.type === 'task') {
    systemPrompt += `\n\nNOTE: The user's voice input may contain transcription errors. Here's what we detected:
- Original input: "${nlpContext.original}"
- Corrected input: "${nlpContext.corrected}"
- Detected intent: ${nlpContext.intent} (confidence: ${(nlpContext.confidence * 100).toFixed(1)}%)
- File paths mentioned: ${nlpContext.filePaths.length > 0 ? nlpContext.filePaths.join(', ') : 'none'}

Be intelligent about interpreting the user's intent even if the transcription isn't perfect.`;
  }

  // Add user message to history
  conversationHistory.push({ role: 'user', content: promptToUse });

  try {
    let continueLoop = true;
    let fullResponse = '';
    let retryCount = 0;
    const maxRetries = 3;

    while (continueLoop && retryCount < maxRetries) {
      try {
        const response = await anthropic.messages.create({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 4096,
          tools: tools,
          system: systemPrompt,
          messages: conversationHistory
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
      } catch (innerError) {
        retryCount++;
        console.error(`API call attempt ${retryCount} failed:`, innerError.message);
        
        if (retryCount >= maxRetries) {
          throw innerError;
        }
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
      }
    }

    // Store conversation in persistent memory
    memoryManager.addConversation(userMessage, fullResponse);
    
    // Monitor conversation for context extraction (local LLM)
    await contextMonitor.onMessage(userMessage, fullResponse);

    return fullResponse;
  } catch (error) {
    console.error('Claude API error:', error);

    // Fallback to friendly error message
    if (error.status === 401) {
      return "I need an API key to work! Please set your ANTHROPIC_API_KEY in the .env file.";
    }

    return "Sorry, I'm having trouble right now. Let me try again.";
  }
}

// WebSocket server for real-time communication
const wss = new WebSocket.Server({ port: 3001 });

wss.on('connection', (ws) => {
  console.log('Client connected');

  ws.on('message', async (message) => {
    const data = JSON.parse(message);

    if (data.type === 'voice_input') {
      // Use NLP handler to interpret the input
      const interpretation = nlpHandler.interpret(data.text);
      
      console.log('NLP Interpretation:', interpretation);

      // Send interpretation back to client for debugging/feedback
      ws.send(JSON.stringify({
        type: 'nlp_debug',
        interpretation: interpretation
      }));

      if (interpretation.type === 'meta_command') {
        // Send command back to client for UI control
        ws.send(JSON.stringify({
          type: 'command',
          action: interpretation.action,
          original: interpretation.original,
          confidence: interpretation.confidence
        }));
      } else if (interpretation.type === 'empty') {
        // Ignore empty input
        return;
      } else {
        // Regular message or task - process with LLM and tools
        try {
          const response = await callLLM(data.text, ws, interpretation);
          
          // Send response to client
          ws.send(JSON.stringify({
            type: 'message',
            text: data.text,
            response: response,
            nlp: interpretation
          }));
          
          // Speak the response
          await speak(response);
          
        } catch (error) {
          console.error('LLM call failed:', error);
          
          const errorMessage = "I'm having trouble. Let me keep trying.";
          
          ws.send(JSON.stringify({
            type: 'message',
            text: data.text,
            response: errorMessage
          }));
          
          await speak(errorMessage);
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

// Initialize services
async function initializeServices() {
  console.log('\n🚀 Initializing services...\n');
  
  // Start log compressor
  await logCompressor.start();
  
  // Initialize context monitor
  await contextMonitor.initialize();
  
  console.log('\n✅ All services initialized\n');
}

app.listen(PORT, async () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`WebSocket server running on port 3001`);
  console.log(`\n🎤 Voice Recognition Features:`);
  console.log(`  - Smart NLP with fuzzy matching for imperfect transcriptions`);
  console.log(`  - Intent detection with confidence scoring`);
  console.log(`  - Common Whisper error correction`);
  console.log(`  - File path extraction from voice commands`);
  console.log(`  - 💾 PERSISTENT MEMORY enabled - remembering context across sessions`);
  console.log(`  - 🗜️  LOG COMPRESSION - using local LLM (saving cloud credits!)`);
  console.log(`  - 🔍 CONTEXT EXTRACTION - organized data for Claude Sonnet 4.5`);
  console.log(`  - 🔊 TEXT-TO-SPEECH enabled - voice responses!`);
  console.log(`\nPlatform Compatibility:`);
  console.log(`  - Chrome/Edge: Full support (Web Speech API)`);
  console.log(`  - Firefox/Safari: MediaRecorder fallback`);
  console.log(`  - Raspberry Pi: Use Chrome/Chromium for best results`);
  
  // Initialize background services
  await initializeServices();
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down gracefully...');
  logCompressor.stop();
  process.exit(0);
});
