# JuzGoFoo

Voice-controlled AI chat interface with intelligent command interpretation.

## Features

- 🎤 **Voice-First Interface** - Double-click input field or use Cmd+Shift+Space to speak
- 🧠 **Intelligent Command Layer** - Automatically detects meta-commands:
  - "Reset" / "Clear" - Clears conversation
  - "Save chat" - Downloads conversation as .txt
  - "Compact this" - Toggles compact view
  - "Scroll to top/bottom" - Auto-scrolls
  - "Copy last response" - Copies to clipboard
- 💬 **Real-time Chat** - WebSocket-based communication with Ollama LLM
- 🎨 **Beautiful UI** - Modern gradient design with voice indicators

## Prerequisites

- Node.js (v14+)
- [Ollama](https://ollama.ai) with llama3.2 model installed

## Installation

```bash
npm install
```

## Usage

```bash
npm start
```

Then open http://localhost:3000 in your browser.

## How It Works

1. **Voice Input**: Uses Web Speech API (built into Chrome/Safari)
2. **Command Interpretation**: Server-side layer detects control commands vs. chat messages
3. **LLM Processing**: Regular messages sent to Ollama for AI responses
4. **Real-time Updates**: WebSocket maintains live connection

## Voice Commands

Just speak naturally:
- "Reset the conversation"
- "Save this chat"
- "Make this compact"
- Or ask anything and get AI responses!

## Tech Stack

- Express.js - Web server
- WebSocket - Real-time communication
- Web Speech API - Voice recognition
- Ollama - Local LLM (llama3.2)

## License

ISC
