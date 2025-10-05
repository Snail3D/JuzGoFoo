#!/usr/bin/env node

const MemorySearch = require('./memory-search');

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  const memorySearch = new MemorySearch();

  // Check if Ollama is available
  const available = await memorySearch.checkAvailability();
  if (!available) {
    console.error('❌ Ollama is not running. Please start Ollama first.');
    console.error('   Run: ollama serve');
    process.exit(1);
  }

  if (!command || command === 'help' || command === '-h' || command === '--help') {
    console.log(`
🔍 Memory Search CLI - Search your conversation history with local LLM

USAGE:
  node search-memory.js <command> [query]

COMMANDS:
  search <query>     Search memory with natural language query
  summarize          Get a summary of all conversation history
  similar <query>    Find similar conversations
  facts              Extract new facts from recent conversations
  status             Check memory status

EXAMPLES:
  node search-memory.js search "what did we discuss about images?"
  node search-memory.js summarize
  node search-memory.js similar "food chat"
  node search-memory.js facts
    `);
    return;
  }

  try {
    switch (command) {
      case 'search':
      case 's': {
        const query = args.slice(1).join(' ');
        if (!query) {
          console.error('❌ Please provide a search query');
          process.exit(1);
        }
        console.log(`🔍 Searching memory for: "${query}"\n`);
        const result = await memorySearch.searchMemory(query);
        if (result.error) {
          console.error(`❌ ${result.error}: ${result.details}`);
        } else {
          console.log('📝 ANSWER:');
          console.log(result.answer);
          console.log(`\n📊 Searched ${result.totalConversations} conversations and ${result.totalFacts} facts`);
        }
        break;
      }

      case 'summarize':
      case 'sum': {
        console.log('📋 Summarizing conversation history...\n');
        const summary = await memorySearch.summarizeHistory();
        console.log('📝 SUMMARY:');
        console.log(summary);
        break;
      }

      case 'similar':
      case 'sim': {
        const query = args.slice(1).join(' ');
        if (!query) {
          console.error('❌ Please provide a query');
          process.exit(1);
        }
        console.log(`🔗 Finding similar conversations to: "${query}"\n`);
        const results = await memorySearch.findSimilar(query);
        if (results.length === 0) {
          console.log('No similar conversations found.');
        } else {
          results.forEach((result, i) => {
            const c = result.conversation;
            console.log(`\n[${i + 1}] ${c.timestamp}`);
            console.log(`User: ${c.user}`);
            console.log(`Assistant: ${c.assistant}`);
          });
        }
        break;
      }

      case 'facts':
      case 'f': {
        console.log('🧠 Extracting new facts from conversations...\n');
        const result = await memorySearch.autoUpdateFacts();
        if (result.factsAdded > 0) {
          console.log(`✅ Added ${result.factsAdded} new facts:`);
          result.facts.forEach(fact => console.log(`  - ${fact}`));
        } else {
          console.log('ℹ️  No new facts to add');
        }
        break;
      }

      case 'status':
      case 'st': {
        const memory = memorySearch.memoryManager.memory;
        console.log('📊 MEMORY STATUS:\n');
        console.log(`System: ${memory.context.system_name}`);
        console.log(`App: ${memory.context.current_app}`);
        console.log(`Session: ${memory.context.session_start}`);
        console.log(`Last Updated: ${memory.context.last_updated}`);
        console.log(`\nConversations: ${memory.memory.recent_conversations.length}`);
        console.log(`Important Facts: ${memory.memory.important_facts.length}`);
        console.log('\nFacts:');
        memory.memory.important_facts.forEach(f => console.log(`  - ${f}`));
        break;
      }

      default:
        console.error(`❌ Unknown command: ${command}`);
        console.log('Run "node search-memory.js help" for usage');
        process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();
