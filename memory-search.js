const LocalModels = require('./local-models');
const MemoryManager = require('./memory-manager');

class MemorySearch {
  constructor(config = {}) {
    this.localModels = new LocalModels(config);
    this.memoryManager = new MemoryManager(config.memoryFilePath);
  }

  /**
   * Search memory using natural language with local LLM
   */
  async searchMemory(query, options = {}) {
    const maxResults = options.maxResults || 5;
    
    // Get all conversation history
    const conversations = this.memoryManager.memory.memory.recent_conversations;
    const facts = this.memoryManager.memory.memory.important_facts;
    
    if (conversations.length === 0 && facts.length === 0) {
      return {
        results: [],
        summary: "No memory data found."
      };
    }

    // Build context for LLM
    const contextData = {
      conversations: conversations,
      facts: facts,
      context: this.memoryManager.memory.context
    };

    const prompt = `You are a memory search assistant. Given the following conversation history and facts, answer the user's query.

CONVERSATION HISTORY:
${conversations.map((c, i) => `[${i}] ${c.timestamp}
User: ${c.user}
Assistant: ${c.assistant}`).join('\n\n')}

IMPORTANT FACTS:
${facts.map((f, i) => `- ${f}`).join('\n')}

SYSTEM CONTEXT:
- System: ${this.memoryManager.memory.context.system_name}
- Current App: ${this.memoryManager.memory.context.current_app}
- Session Start: ${this.memoryManager.memory.context.session_start}

USER QUERY: ${query}

Please provide:
1. Direct answer to the query
2. Relevant conversation references (by index if applicable)
3. Related facts

Be concise and specific.`;

    try {
      const response = await this.localModels.generateText(prompt, {
        temperature: 0.3, // Lower temp for more focused responses
        maxTokens: 1024
      });

      return {
        query: query,
        answer: response,
        totalConversations: conversations.length,
        totalFacts: facts.length
      };
    } catch (error) {
      console.error('Error searching memory:', error);
      return {
        error: 'Failed to search memory',
        details: error.message
      };
    }
  }

  /**
   * Summarize entire conversation history
   */
  async summarizeHistory(options = {}) {
    const conversations = this.memoryManager.memory.memory.recent_conversations;
    
    if (conversations.length === 0) {
      return "No conversation history to summarize.";
    }

    const prompt = `Summarize the following conversation history. Focus on:
- Main topics discussed
- Key decisions or actions
- Important information mentioned
- Overall context

CONVERSATION HISTORY:
${conversations.map(c => `${c.timestamp}
User: ${c.user}
Assistant: ${c.assistant}`).join('\n\n')}

Provide a concise but comprehensive summary:`;

    try {
      const summary = await this.localModels.generateText(prompt, {
        temperature: 0.5,
        maxTokens: 512
      });

      return summary;
    } catch (error) {
      console.error('Error summarizing history:', error);
      return `Error: ${error.message}`;
    }
  }

  /**
   * Extract important facts from conversations using LLM
   */
  async extractFacts(options = {}) {
    const conversations = this.memoryManager.memory.memory.recent_conversations;
    const existingFacts = this.memoryManager.memory.memory.important_facts;
    
    if (conversations.length === 0) {
      return [];
    }

    const prompt = `Analyze the following conversations and extract NEW important facts that should be remembered long-term.

EXISTING FACTS (don't repeat these):
${existingFacts.map(f => `- ${f}`).join('\n')}

RECENT CONVERSATIONS:
${conversations.map(c => `User: ${c.user}\nAssistant: ${c.assistant}`).join('\n\n')}

Extract ONLY new facts that are:
- Important for future reference
- Not already in the existing facts
- Concrete information (not opinions)
- User preferences, decisions, or system configuration

Format as a simple list, one fact per line, starting each with "- "`;

    try {
      const response = await this.localModels.generateText(prompt, {
        temperature: 0.3,
        maxTokens: 512
      });

      // Parse the response into individual facts
      const newFacts = response
        .split('\n')
        .filter(line => line.trim().startsWith('-'))
        .map(line => line.replace(/^-\s*/, '').trim())
        .filter(fact => fact && !existingFacts.includes(fact));

      return newFacts;
    } catch (error) {
      console.error('Error extracting facts:', error);
      return [];
    }
  }

  /**
   * Auto-update facts from recent conversations
   */
  async autoUpdateFacts() {
    const newFacts = await this.extractFacts();
    
    if (newFacts.length > 0) {
      newFacts.forEach(fact => {
        this.memoryManager.addImportantFact(fact);
      });
      
      return {
        success: true,
        factsAdded: newFacts.length,
        facts: newFacts
      };
    }
    
    return {
      success: true,
      factsAdded: 0,
      message: "No new facts to add"
    };
  }

  /**
   * Find similar conversations based on semantic meaning
   */
  async findSimilar(query, options = {}) {
    const conversations = this.memoryManager.memory.memory.recent_conversations;
    const maxResults = options.maxResults || 3;

    if (conversations.length === 0) {
      return [];
    }

    const prompt = `Given the following query, identify the ${maxResults} most relevant conversations from the list below.

QUERY: ${query}

CONVERSATIONS:
${conversations.map((c, i) => `[${i}] User: ${c.user}\nAssistant: ${c.assistant}`).join('\n\n')}

Respond with ONLY the conversation indices (numbers in brackets) that are most relevant, separated by commas. For example: 0, 3, 7`;

    try {
      const response = await this.localModels.generateText(prompt, {
        temperature: 0.2,
        maxTokens: 100
      });

      // Parse indices from response
      const indices = response
        .match(/\d+/g)
        ?.map(n => parseInt(n))
        .filter(i => i >= 0 && i < conversations.length)
        .slice(0, maxResults) || [];

      return indices.map(i => ({
        index: i,
        conversation: conversations[i]
      }));
    } catch (error) {
      console.error('Error finding similar conversations:', error);
      return [];
    }
  }

  /**
   * Check if Ollama is available
   */
  async checkAvailability() {
    return await this.localModels.checkOllamaAvailable();
  }
}

module.exports = MemorySearch;
