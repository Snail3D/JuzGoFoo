const fs = require('fs').promises;
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

/**
 * Context Monitor
 * Uses local LLM to extract and organize conversation context
 * Optimized for Claude Sonnet 4.5's consumption
 */

class ContextMonitor {
  constructor(config = {}) {
    this.config = {
      memoryFile: config.memoryFile || './conversation-memory.json',
      contextFile: config.contextFile || './extracted-context.json',
      promptFile: config.promptFile || './llm-context-extractor-prompt.md',
      ollamaModel: config.ollamaModel || 'mistral', // mistral is better for JSON
      messagesBeforeExtract: config.messagesBeforeExtract || 3,
      ...config
    };
    
    this.messageCount = 0;
    this.extractedContext = this.loadContext();
    this.systemPrompt = null;
  }

  /**
   * Initialize the monitor
   */
  async initialize() {
    // Load system prompt
    try {
      this.systemPrompt = await fs.readFile(this.config.promptFile, 'utf8');
      console.log('📋 Context extraction prompt loaded');
    } catch (error) {
      console.warn('⚠️  Could not load prompt file:', error.message);
    }
    
    // Check Ollama availability
    await this.checkOllama();
  }

  /**
   * Check if Ollama is available
   */
  async checkOllama() {
    try {
      await execAsync('which ollama');
      const { stdout } = await execAsync(`ollama list`);
      
      if (stdout.includes(this.config.ollamaModel)) {
        console.log(`✅ Ollama with ${this.config.ollamaModel} ready`);
      } else {
        console.warn(`⚠️  Model ${this.config.ollamaModel} not found. Run: ollama pull ${this.config.ollamaModel}`);
      }
    } catch (error) {
      console.warn('⚠️  Ollama not found. Install from: https://ollama.ai');
    }
  }

  /**
   * Load existing context
   */
  async loadContext() {
    try {
      const data = await fs.readFile(this.config.contextFile, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      // Return default structure
      return {
        incomplete_thoughts: { pending_items: [] },
        user_preferences: { technical_preferences: [], communication_style: '', recurring_themes: [] },
        action_items: { completed: [], pending: [], blocked: [] },
        technical_context: { file_paths_mentioned: [], technologies: [], system_info: {} },
        conversation_state: { current_focus: '', recent_decisions: [], open_questions: [] },
        entity_tracking: { projects: {}, files_modified: [], commands_run: [] },
        last_updated: null
      };
    }
  }

  /**
   * Monitor a new message exchange
   */
  async onMessage(userMessage, assistantResponse) {
    this.messageCount++;
    
    // Check if we should extract context
    if (this.messageCount >= this.config.messagesBeforeExtract) {
      await this.extractContext();
      this.messageCount = 0;
    }
  }

  /**
   * Extract context from recent conversations using local LLM
   */
  async extractContext() {
    try {
      console.log('🔍 Extracting context with local LLM...');
      
      // Load recent conversations
      const memoryData = await fs.readFile(this.config.memoryFile, 'utf8');
      const memory = JSON.parse(memoryData);
      const recent = memory.memory?.recent_conversations || [];
      
      // Get last N conversations for context extraction
      const toAnalyze = recent.slice(-5);
      
      if (toAnalyze.length === 0) {
        return;
      }
      
      // Prepare conversation text
      const conversationText = toAnalyze.map(c => 
        `[${c.timestamp}]\nUser: ${c.user}\nAssistant: ${c.assistant.substring(0, 500)}...`
      ).join('\n\n');
      
      // Load current context
      const currentContext = await this.loadContext();
      
      // Create extraction prompt
      const prompt = `${this.systemPrompt}

## Current Context State
${JSON.stringify(currentContext, null, 2)}

## Recent Conversations to Analyze
${conversationText}

## Task
Update the context JSON above based on the new conversation data. Extract any new:
- Incomplete thoughts or interrupted statements
- Action items (pending, completed, blocked)
- File paths, technologies, or technical details
- User preferences or patterns
- Changes to conversation focus

Output ONLY the updated JSON, no other text.`;

      // Call Ollama
      const response = await this.callOllama(prompt);
      
      // Parse and validate response
      const newContext = this.parseAndValidate(response);
      
      if (newContext) {
        newContext.last_updated = new Date().toISOString();
        
        // Save updated context
        await fs.writeFile(
          this.config.contextFile,
          JSON.stringify(newContext, null, 2),
          'utf8'
        );
        
        this.extractedContext = newContext;
        console.log('✅ Context extracted and saved (local LLM - no cloud costs!)');
        
        // Log summary
        this.logContextSummary(newContext);
      }
      
    } catch (error) {
      console.error('❌ Context extraction failed:', error.message);
    }
  }

  /**
   * Call Ollama API
   */
  async callOllama(prompt) {
    try {
      // Escape prompt for shell
      const escapedPrompt = prompt.replace(/"/g, '\\"').replace(/\$/g, '\\$');
      
      // Use Ollama API with JSON mode
      const command = `echo "${escapedPrompt}" | ollama run ${this.config.ollamaModel} --format json`;
      
      const { stdout, stderr } = await execAsync(command, { 
        maxBuffer: 5 * 1024 * 1024, // 5MB buffer
        timeout: 30000 // 30 second timeout
      });
      
      if (stderr) {
        console.warn('Ollama stderr:', stderr);
      }
      
      return stdout.trim();
      
    } catch (error) {
      console.error('Ollama call failed:', error.message);
      throw error;
    }
  }

  /**
   * Parse and validate LLM response
   */
  parseAndValidate(response) {
    try {
      // Try to extract JSON if there's extra text
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? jsonMatch[0] : response;
      
      const parsed = JSON.parse(jsonStr);
      
      // Validate structure
      const required = [
        'incomplete_thoughts',
        'user_preferences',
        'action_items',
        'technical_context',
        'conversation_state',
        'entity_tracking'
      ];
      
      for (const key of required) {
        if (!(key in parsed)) {
          console.warn(`Missing required key: ${key}`);
          parsed[key] = {};
        }
      }
      
      return parsed;
      
    } catch (error) {
      console.error('Failed to parse LLM response:', error.message);
      console.error('Response was:', response.substring(0, 200));
      return null;
    }
  }

  /**
   * Log summary of extracted context
   */
  logContextSummary(context) {
    const summary = {
      incomplete_thoughts: context.incomplete_thoughts?.pending_items?.length || 0,
      pending_actions: context.action_items?.pending?.length || 0,
      completed_actions: context.action_items?.completed?.length || 0,
      open_questions: context.conversation_state?.open_questions?.length || 0,
      files_tracked: context.entity_tracking?.files_modified?.length || 0
    };
    
    console.log('📊 Context summary:', JSON.stringify(summary, null, 2));
  }

  /**
   * Get formatted context for Claude
   */
  async getContextForClaude() {
    const context = await this.loadContext();
    
    // Format in a way that's easy for Claude to parse
    let formatted = '=== EXTRACTED CONTEXT (from local LLM monitoring) ===\n\n';
    
    // Incomplete thoughts (high priority)
    if (context.incomplete_thoughts?.pending_items?.length > 0) {
      formatted += '🔴 INCOMPLETE THOUGHTS (user may return to these):\n';
      context.incomplete_thoughts.pending_items.forEach((item, i) => {
        formatted += `  ${i + 1}. "${item.original_statement}"\n`;
        formatted += `     → Inferred: ${item.inferred_intent}\n`;
        formatted += `     → Context: ${item.context}\n\n`;
      });
    }
    
    // Pending actions (high priority)
    if (context.action_items?.pending?.length > 0) {
      formatted += '📋 PENDING ACTIONS:\n';
      context.action_items.pending.forEach((item, i) => {
        formatted += `  ${i + 1}. ${item.action}\n`;
        if (item.blocks) formatted += `     → Blocks: ${item.blocks.join(', ')}\n`;
      });
      formatted += '\n';
    }
    
    // Current focus
    if (context.conversation_state?.current_focus) {
      formatted += `🎯 CURRENT FOCUS: ${context.conversation_state.current_focus}\n\n`;
    }
    
    // Open questions
    if (context.conversation_state?.open_questions?.length > 0) {
      formatted += '❓ OPEN QUESTIONS:\n';
      context.conversation_state.open_questions.forEach((q, i) => {
        formatted += `  ${i + 1}. ${q}\n`;
      });
      formatted += '\n';
    }
    
    // Technical context
    if (context.technical_context?.file_paths_mentioned?.length > 0) {
      formatted += `📁 FILES MENTIONED: ${context.technical_context.file_paths_mentioned.join(', ')}\n`;
    }
    
    if (context.technical_context?.technologies?.length > 0) {
      formatted += `🔧 TECH STACK: ${context.technical_context.technologies.join(', ')}\n`;
    }
    
    formatted += '\n=== END EXTRACTED CONTEXT ===\n';
    
    return formatted;
  }

  /**
   * Force immediate extraction
   */
  async forceExtract() {
    this.messageCount = this.config.messagesBeforeExtract;
    await this.extractContext();
  }
}

module.exports = ContextMonitor;

// Run standalone for testing
if (require.main === module) {
  (async () => {
    const monitor = new ContextMonitor({
      ollamaModel: 'mistral' // Good for JSON output
    });
    
    await monitor.initialize();
    
    // Force extraction
    console.log('\n🚀 Running context extraction...\n');
    await monitor.forceExtract();
    
    // Show formatted context
    console.log('\n' + '='.repeat(60));
    const formatted = await monitor.getContextForClaude();
    console.log(formatted);
    
  })();
}
