const fs = require('fs');
const path = require('path');

class MemoryManager {
  constructor(memoryFilePath = './conversation-memory.json') {
    this.memoryFilePath = memoryFilePath;
    this.memory = this.loadMemory();
  }

  loadMemory() {
    try {
      if (fs.existsSync(this.memoryFilePath)) {
        const data = fs.readFileSync(this.memoryFilePath, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      console.error('Error loading memory:', error);
    }
    
    // Default memory structure
    return {
      context: {
        system_name: "JuzGoFoo",
        current_app: "Jesco food chat",
        session_start: new Date().toISOString(),
        last_updated: new Date().toISOString(),
        conversation_topics: []
      },
      memory: {
        user_preferences: {},
        recent_conversations: [],
        important_facts: [
          "This is the Jesco food chat application",
          "Running on JuzGoFoo voice-controlled terminal"
        ]
      }
    };
  }

  saveMemory() {
    try {
      this.memory.context.last_updated = new Date().toISOString();
      fs.writeFileSync(this.memoryFilePath, JSON.stringify(this.memory, null, 2), 'utf8');
    } catch (error) {
      console.error('Error saving memory:', error);
    }
  }

  addConversation(userMessage, assistantResponse) {
    const conversation = {
      timestamp: new Date().toISOString(),
      user: userMessage,
      assistant: assistantResponse.substring(0, 200) // Store summary
    };

    this.memory.memory.recent_conversations.push(conversation);
    
    // Keep only last 10 conversations
    if (this.memory.memory.recent_conversations.length > 10) {
      this.memory.memory.recent_conversations.shift();
    }

    this.saveMemory();
  }

  addImportantFact(fact) {
    if (!this.memory.memory.important_facts.includes(fact)) {
      this.memory.memory.important_facts.push(fact);
      this.saveMemory();
    }
  }

  updateContext(key, value) {
    this.memory.context[key] = value;
    this.saveMemory();
  }

  getContextPrompt() {
    const facts = this.memory.memory.important_facts.join('\\n- ');
    const recentConvos = this.memory.memory.recent_conversations
      .slice(-3)
      .map(c => `User: ${c.user}\\nAssistant: ${c.assistant}`)
      .join('\\n\\n');

    return `
PERSISTENT MEMORY CONTEXT:
- System: ${this.memory.context.system_name}
- Current Application: ${this.memory.context.current_app}
- Session Start: ${this.memory.context.session_start}

Important Facts:
- ${facts}

${recentConvos ? 'Recent Conversation Context:\\n' + recentConvos : ''}
`;
  }

  clearMemory() {
    this.memory = this.loadMemory();
    this.saveMemory();
  }
}

module.exports = MemoryManager;
