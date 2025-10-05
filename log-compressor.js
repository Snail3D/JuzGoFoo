const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

/**
 * Log Compression Service
 * Uses local LLM (Ollama) to shrink logs and save cloud API costs
 * Runs periodically to compress conversation memory
 */

class LogCompressor {
  constructor(config = {}) {
    this.config = {
      memoryFile: config.memoryFile || './conversation-memory.json',
      backupDir: config.backupDir || './log-backups',
      compressionThreshold: config.compressionThreshold || 10, // compress after 10 conversations
      ollamaModel: config.ollamaModel || 'llama2', // or 'mistral', 'phi', etc.
      checkInterval: config.checkInterval || 60000, // check every minute
      maxRecentConversations: config.maxRecentConversations || 5,
      ...config
    };
    
    this.isCompressing = false;
  }

  /**
   * Start the compression service
   */
  async start() {
    console.log('🗜️  Log Compressor started (using local LLM - saving cloud credits!)');
    console.log(`   Model: ${this.config.ollamaModel}`);
    console.log(`   Check interval: ${this.config.checkInterval / 1000}s`);
    
    // Check if Ollama is available
    await this.checkOllama();
    
    // Start periodic compression
    this.compressionInterval = setInterval(async () => {
      await this.checkAndCompress();
    }, this.config.checkInterval);
    
    // Run initial check
    await this.checkAndCompress();
  }

  /**
   * Stop the compression service
   */
  stop() {
    if (this.compressionInterval) {
      clearInterval(this.compressionInterval);
      console.log('🗜️  Log Compressor stopped');
    }
  }

  /**
   * Check if Ollama is available
   */
  async checkOllama() {
    try {
      await execAsync('which ollama');
      console.log('✅ Ollama found');
    } catch (error) {
      console.warn('⚠️  Ollama not found. Install with: curl -fsSL https://ollama.ai/install.sh | sh');
      console.warn('   Then run: ollama pull ' + this.config.ollamaModel);
    }
  }

  /**
   * Check if compression is needed and perform it
   */
  async checkAndCompress() {
    if (this.isCompressing) {
      return; // Already compressing
    }

    try {
      this.isCompressing = true;
      
      // Read memory file
      const data = await fs.readFile(this.config.memoryFile, 'utf8');
      const memory = JSON.parse(data);
      
      const recentConversations = memory.memory?.recent_conversations || [];
      
      // Check if compression is needed
      if (recentConversations.length > this.config.compressionThreshold) {
        console.log(`📊 Log size: ${recentConversations.length} conversations - compressing...`);
        await this.compressLogs(memory);
      }
      
    } catch (error) {
      console.error('❌ Compression check error:', error.message);
    } finally {
      this.isCompressing = false;
    }
  }

  /**
   * Compress logs using local LLM
   */
  async compressLogs(memory) {
    try {
      // Backup original
      await this.createBackup(memory);
      
      const recentConversations = memory.memory.recent_conversations || [];
      
      // Keep most recent conversations
      const toKeep = recentConversations.slice(-this.config.maxRecentConversations);
      const toCompress = recentConversations.slice(0, -this.config.maxRecentConversations);
      
      if (toCompress.length === 0) {
        return;
      }
      
      console.log(`   Keeping: ${toKeep.length} recent conversations`);
      console.log(`   Compressing: ${toCompress.length} older conversations`);
      
      // Create summary of old conversations using local LLM
      const summary = await this.summarizeWithLLM(toCompress);
      
      // Add summary to important facts
      if (!memory.memory.important_facts) {
        memory.memory.important_facts = [];
      }
      
      memory.memory.important_facts.push({
        type: 'compressed_history',
        timestamp: new Date().toISOString(),
        summary: summary,
        original_count: toCompress.length
      });
      
      // Keep only recent conversations
      memory.memory.recent_conversations = toKeep;
      memory.context.last_updated = new Date().toISOString();
      
      // Save compressed memory
      await fs.writeFile(
        this.config.memoryFile,
        JSON.stringify(memory, null, 2),
        'utf8'
      );
      
      const savedSize = toCompress.length - 1; // We replaced N conversations with 1 summary
      console.log(`✅ Compressed ${toCompress.length} conversations into summary`);
      console.log(`   Saved ~${savedSize} conversation entries`);
      
    } catch (error) {
      console.error('❌ Compression failed:', error.message);
    }
  }

  /**
   * Summarize conversations using local LLM (Ollama)
   */
  async summarizeWithLLM(conversations) {
    try {
      // Prepare conversation text
      const conversationText = conversations.map(c => 
        `[${c.timestamp}]\nUser: ${c.user}\nAssistant: ${c.assistant}`
      ).join('\n\n');
      
      const prompt = `Summarize this conversation history into 2-3 concise bullet points, focusing on key user preferences, decisions, and important context. Be brief but preserve critical information:\n\n${conversationText}\n\nSummary:`;
      
      // Call Ollama API
      const command = `ollama run ${this.config.ollamaModel} "${prompt.replace(/"/g, '\\"')}"`;
      
      console.log('   🤖 Calling local LLM...');
      const { stdout } = await execAsync(command, { maxBuffer: 1024 * 1024 });
      
      const summary = stdout.trim();
      console.log('   ✨ Summary generated (local - no cloud costs!)');
      
      return summary;
      
    } catch (error) {
      console.error('   ⚠️  LLM summarization failed, using fallback:', error.message);
      return this.fallbackSummarize(conversations);
    }
  }

  /**
   * Fallback summarization without LLM
   */
  fallbackSummarize(conversations) {
    const topics = new Set();
    const keywords = ['screenshot', 'save', 'create', 'make', 'want', 'like', 'need'];
    
    conversations.forEach(c => {
      keywords.forEach(keyword => {
        if (c.user.toLowerCase().includes(keyword)) {
          topics.add(c.user.substring(0, 100));
        }
      });
    });
    
    return `Compressed ${conversations.length} conversations from ${conversations[0]?.timestamp} to ${conversations[conversations.length - 1]?.timestamp}. Topics: ${Array.from(topics).slice(0, 3).join('; ')}`;
  }

  /**
   * Create backup of memory file
   */
  async createBackup(memory) {
    try {
      // Ensure backup directory exists
      await fs.mkdir(this.config.backupDir, { recursive: true });
      
      const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
      const backupFile = path.join(this.config.backupDir, `memory-backup-${timestamp}.json`);
      
      await fs.writeFile(backupFile, JSON.stringify(memory, null, 2), 'utf8');
      console.log(`   💾 Backup created: ${backupFile}`);
      
      // Keep only last 10 backups
      await this.cleanOldBackups();
      
    } catch (error) {
      console.error('   ⚠️  Backup failed:', error.message);
    }
  }

  /**
   * Clean old backups, keep only recent ones
   */
  async cleanOldBackups() {
    try {
      const files = await fs.readdir(this.config.backupDir);
      const backups = files
        .filter(f => f.startsWith('memory-backup-'))
        .sort()
        .reverse();
      
      // Keep only last 10
      const toDelete = backups.slice(10);
      
      for (const file of toDelete) {
        await fs.unlink(path.join(this.config.backupDir, file));
      }
      
      if (toDelete.length > 0) {
        console.log(`   🗑️  Cleaned ${toDelete.length} old backups`);
      }
      
    } catch (error) {
      // Ignore errors
    }
  }

  /**
   * Get compression stats
   */
  async getStats() {
    try {
      const data = await fs.readFile(this.config.memoryFile, 'utf8');
      const memory = JSON.parse(data);
      
      const recentCount = memory.memory?.recent_conversations?.length || 0;
      const compressedCount = memory.memory?.important_facts?.filter(
        f => f.type === 'compressed_history'
      ).length || 0;
      
      return {
        current_conversations: recentCount,
        compressed_batches: compressedCount,
        needs_compression: recentCount > this.config.compressionThreshold
      };
      
    } catch (error) {
      return { error: error.message };
    }
  }
}

// Export for use in server
module.exports = LogCompressor;

// Run standalone if executed directly
if (require.main === module) {
  const compressor = new LogCompressor({
    compressionThreshold: 10,
    checkInterval: 60000, // 1 minute
    ollamaModel: 'llama2' // or 'mistral', 'phi', 'tinyllama'
  });
  
  compressor.start();
  
  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n👋 Shutting down...');
    compressor.stop();
    process.exit(0);
  });
}
