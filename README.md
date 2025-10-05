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
- 💬 **Powered by Claude Sonnet 4.5** - Real AI conversations via Anthropic API
- 🎨 **Matrix Terminal Theme** - Black background with green CRT effects
- 🌐 **Cross-Platform** - Works on Mac, Windows, Raspberry Pi, and Linux

## Prerequisites

- Node.js (v14+)
- **Anthropic API Key** - Get one at [console.anthropic.com](https://console.anthropic.com/settings/keys)
- **Recommended Browser**: Chrome or Edge (for Web Speech API)

## Installation

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file with your API key:
```bash
echo "ANTHROPIC_API_KEY=your_api_key_here" > .env
```

## Usage

```bash
npm start
```

Then open http://localhost:3000 in your browser and start speaking!

## How It Works

1. **Voice Input**:
   - **Primary**: Web Speech API (Chrome/Edge on all platforms)
   - **Fallback**: MediaRecorder API for Firefox/Safari
2. **Command Interpretation**: Server-side layer detects control commands vs. chat messages
3. **LLM Processing**: Messages sent to **Claude Sonnet 4.5** via Anthropic API
4. **Real-time Updates**: WebSocket maintains live connection

## Cross-Platform Support

| Platform | Browser | Voice Input | Status |
|----------|---------|-------------|--------|
| **Mac** | Chrome/Edge | Web Speech API | ✅ Full Support |
| **Mac** | Firefox/Safari | MediaRecorder | ⚠️ Limited |
| **Windows** | Chrome/Edge | Web Speech API | ✅ Full Support |
| **Linux** | Chrome/Chromium | Web Speech API | ✅ Full Support |
| **Raspberry Pi** | Chromium | Web Speech API | ✅ Full Support |

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
