const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;

const execAsync = promisify(exec);

class TokenMonitor {
  constructor(options = {}) {
    this.tokenThreshold = options.tokenThreshold || 120000;
    this.ollamaModel = options.ollamaModel || 'llama2';
    this.currentTokenCount = 0;
    this.conversationBuffer = [];
    this.summaryFile = options.summaryFile || './conversation-summary.json';
    this.isProcessing = false;
    
    console.log(`📊 Token Monitor initialized (threshold: ${this.tokenThreshold} tokens)`);
    
    // Load existing token count
    this.loadState();
  }
  
  async loadState() {
    try {
      const data = await fs.readFile(this.summaryFile, 'utf8');
      const state = JSON.parse(data);
      this.currentTokenCount = state.totalTokens || 0;
      console.log(`📊 Loaded token count: ${this.currentTokenCount} tokens`);
    } catch (error) {
      // File doesn't exist yet, start fresh
      this.currentTokenCount = 0;
    }
  }
  
  async saveState(summary = null) {
    const state = {
      totalTokens: this.currentTokenCount,
      lastProcessed: new Date().toISOString(),
      summary: summary
    };
    
    await fs.writeFile(this.summaryFile, JSON.stringify(state, null, 2), 'utf8');
  }
  
  // Rough token estimation (4 chars ≈ 1 token)
  estimateTokens(text) {
    return Math.ceil(text.length / 4);
  }
  
  // Add message and track tokens
  async addMessage(userMessage, assistantResponse) {
    const userTokens = this.estimateTokens(userMessage);
    const assistantTokens = this.estimateTokens(assistantResponse);
    const totalNew = userTokens + assistantTokens;
    
    this.currentTokenCount += totalNew;
    this.conversationBuffer.push({
      user: userMessage,
      assistant: assistantResponse,
      tokens: totalNew,
      timestamp: new Date().toISOString()
    });
    
    console.log(`📊 Token count: ${this.currentTokenCount}/${this.tokenThreshold} (+${totalNew})`);
    
    // Check if we've hit the threshold
    if (this.currentTokenCount >= this.tokenThreshold && !this.isProcessing) {
      console.log('🚨 Token threshold reached! Triggering background Llama process...');
      await this.processWithLlama();
    }
  }
  
  // Run Llama in background to compress/summarize
  async processWithLlama() {
    if (this.isProcessing) {
      console.log('⏳ Already processing, skipping...');
      return;
    }
    
    this.isProcessing = true;
    
    try {
      console.log('🦙 Starting Llama background processing...');
      
      // Read the current memory file
      let memoryData = {};
      try {
        const memoryContent = await fs.readFile('./conversation-memory.json', 'utf8');
        memoryData = JSON.parse(memoryContent);
      } catch (error) {
        console.log('No existing memory file found, starting fresh');
      }
      
      // Create a comprehensive summary of the conversation buffer
      const conversationText = this.conversationBuffer.map(msg => 
        `User: ${msg.user}\nAssistant: ${msg.assistant}`
      ).join('\n\n');
      
      const prompt = `You are a context summarizer. You've been given ${this.currentTokenCount} tokens of conversation history.

Your task is to create a concise, information-dense summary that preserves:
1. Key facts and decisions made
2. Important file paths and system states
3. User preferences and project context
4. Any ongoing tasks or goals

Current conversation buffer (${this.conversationBuffer.length} messages):

${conversationText}

Previous important facts:
${JSON.stringify(memoryData.importantFacts || [], null, 2)}

Provide your summary as a JSON object with:
{
  "keyFacts": ["fact1", "fact2", ...],
  "systemState": "description of current system/project state",
  "ongoingTasks": ["task1", "task2", ...],
  "contextSummary": "brief overall summary"
}`;

      // Call Ollama
      const response = await this.callOllama(prompt);
      
      // Parse the response
      let summary;
      try {
        // Extract JSON from markdown code blocks if present
        let jsonText = response;
        const jsonMatch = response.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
        if (jsonMatch) {
          jsonText = jsonMatch[1];
        }
        
        summary = JSON.parse(jsonText);
      } catch (error) {
        console.error('Failed to parse Llama response as JSON:', error);
        summary = {
          keyFacts: [],
          systemState: "Unable to parse summary",
          ongoingTasks: [],
          contextSummary: response.substring(0, 500)
        };
      }
      
      console.log('✅ Llama processing complete!');
      console.log('📝 Summary:', summary.contextSummary);
      
      // Save the summary
      await this.saveState(summary);
      
      // Clear the buffer and reset counter
      this.conversationBuffer = [];
      this.currentTokenCount = 0;
      
      // Update memory file with new context
      memoryData.importantFacts = [
        ...(summary.keyFacts || []),
        `[${new Date().toISOString()}] Context compressed at 120k tokens: ${summary.contextSummary}`
      ].slice(-20); // Keep last 20 facts
      
      await fs.writeFile(
        './conversation-memory.json',
        JSON.stringify(memoryData, null, 2),
        'utf8'
      );
      
    } catch (error) {
      console.error('❌ Error processing with Llama:', error);
    } finally {
      this.isProcessing = false;
    }
  }
  
  // Call Ollama with a prompt
  async callOllama(prompt) {
    try {
      const command = `ollama run ${this.ollamaModel} "${prompt.replace(/"/g, '\\"')}"`;
      const { stdout } = await execAsync(command, {
        maxBuffer: 10 * 1024 * 1024 // 10MB buffer
      });
      
      return stdout.trim();
    } catch (error) {
      console.error('Ollama execution error:', error);
      throw error;
    }
  }
  
  // Get current status
  getStatus() {
    return {
      currentTokens: this.currentTokenCount,
      threshold: this.tokenThreshold,
      percentage: ((this.currentTokenCount / this.tokenThreshold) * 100).toFixed(1),
      bufferSize: this.conversationBuffer.length,
      isProcessing: this.isProcessing
    };
  }
}

module.exports = TokenMonitor;
