/**
 * Natural Language Processing Handler
 * Handles imperfect transcriptions from Whisper with fuzzy matching and intent recognition
 */

const stringSimilarity = require('string-similarity');

class NLPHandler {
  constructor() {
    // Common Whisper transcription errors and corrections
    this.whisperCorrections = {
      // Homophones and common misheard words
      'read': ['red', 'reed', 'rid'],
      'write': ['right', 'rite'],
      'file': ['file', 'while', 'style'],
      'delete': ['delete', 'd lead', 'the lead'],
      'create': ['create', 'great'],
      'open': ['open', 'opening'],
      'close': ['close', 'clothes'],
      'list': ['list', 'lists', 'missed'],
      'show': ['show', 'so', 'sew'],
      'find': ['find', 'fine', 'signed'],
      'search': ['search', 'surge', 'urch'],
      'run': ['run', 'one'],
      'execute': ['execute', 'exit cute'],
      'make': ['make', 'lake'],
      'new': ['new', 'knew', 'gnu'],
      'save': ['save', 'shave'],
      'copy': ['copy', 'coffee'],
      'move': ['move', 'moved', 'love'],
      'install': ['install', 'in stall'],
      'terminal': ['terminal', 'term null'],
      'directory': ['directory', 'directly'],
      'folder': ['folder', 'older'],
    };

    // Intent patterns with variations
    this.intents = {
      file_read: {
        keywords: ['read', 'show', 'display', 'open', 'view', 'see', 'look at', 'cat', 'check'],
        objects: ['file', 'document', 'code', 'script', 'text'],
        confidence: 0.6
      },
      file_write: {
        keywords: ['write', 'create', 'make', 'save', 'edit', 'modify', 'update', 'change'],
        objects: ['file', 'document', 'code', 'script'],
        confidence: 0.6
      },
      file_delete: {
        keywords: ['delete', 'remove', 'erase', 'trash', 'kill'],
        objects: ['file', 'document', 'code', 'folder'],
        confidence: 0.7
      },
      file_list: {
        keywords: ['list', 'show', 'display', 'see', 'what', 'ls', 'dir'],
        objects: ['files', 'directories', 'folder', 'directory', 'contents'],
        confidence: 0.6
      },
      execute_command: {
        keywords: ['run', 'execute', 'start', 'launch', 'perform', 'do'],
        objects: ['command', 'script', 'program', 'code'],
        confidence: 0.6
      },
      search: {
        keywords: ['find', 'search', 'look for', 'locate', 'where', 'grep'],
        objects: ['file', 'text', 'code', 'string', 'word'],
        confidence: 0.6
      },
      install: {
        keywords: ['install', 'add', 'get', 'download', 'npm', 'pip', 'apt'],
        objects: ['package', 'library', 'module', 'dependency'],
        confidence: 0.7
      }
    };

    // Meta-commands for UI control
    this.metaCommands = {
      reset: ['reset', 'clear', 'start over', 'new conversation', 'restart'],
      save: ['save chat', 'export chat', 'download chat', 'save conversation'],
      scroll_up: ['scroll up', 'go up', 'move up'],
      scroll_down: ['scroll down', 'go down', 'move down'],
      scroll_top: ['scroll to top', 'go to top', 'top'],
      scroll_bottom: ['scroll to bottom', 'go to bottom', 'bottom'],
      copy: ['copy response', 'copy message', 'copy last', 'copy that'],
      help: ['help', 'what can you do', 'show help', 'commands']
    };
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  levenshteinDistance(str1, str2) {
    const matrix = [];
    
    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    return matrix[str2.length][str1.length];
  }

  /**
   * Apply common Whisper corrections to text
   */
  correctWhisperErrors(text) {
    let corrected = text.toLowerCase();
    
    // Fix common phrase errors
    corrected = corrected
      .replace(/\bexit cute\b/g, 'execute')
      .replace(/\bin stall\b/g, 'install')
      .replace(/\bterm null\b/g, 'terminal')
      .replace(/\bd lead\b/g, 'delete')
      .replace(/\bthe lead\b/g, 'delete')
      .replace(/\bfile path\b/g, 'filepath')
      .replace(/\bcd /g, 'cd ')  // Change directory
      .replace(/\bgit /g, 'git '); // Git commands
    
    return corrected;
  }

  /**
   * Check if text matches a meta-command with fuzzy matching
   */
  detectMetaCommand(text) {
    const corrected = this.correctWhisperErrors(text);
    const threshold = 0.85; // Increased from 0.7 to make reset less sensitive
    
    for (const [command, patterns] of Object.entries(this.metaCommands)) {
      for (const pattern of patterns) {
        // Direct substring match
        if (corrected.includes(pattern)) {
          return { isCommand: true, action: command, confidence: 1.0, original: text };
        }
        
        // Fuzzy match
        const similarity = 1 - (this.levenshteinDistance(corrected, pattern) / Math.max(corrected.length, pattern.length));
        if (similarity >= threshold) {
          return { isCommand: true, action: command, confidence: similarity, original: text };
        }
      }
    }
    
    return null;
  }

  /**
   * Extract intent from user input with fuzzy matching
   */
  extractIntent(text) {
    const corrected = this.correctWhisperErrors(text);
    const words = corrected.split(/\s+/);
    
    let bestIntent = null;
    let bestScore = 0;
    
    for (const [intentName, intentData] of Object.entries(this.intents)) {
      let score = 0;
      let keywordMatches = 0;
      let objectMatches = 0;
      
      // Check for keyword matches with fuzzy matching
      for (const keyword of intentData.keywords) {
        for (const word of words) {
          const similarity = 1 - (this.levenshteinDistance(word, keyword) / Math.max(word.length, keyword.length));
          if (similarity >= 0.7) {
            keywordMatches++;
            score += similarity;
          }
          
          // Check if keyword is a substring
          if (corrected.includes(keyword)) {
            keywordMatches++;
            score += 1;
          }
        }
      }
      
      // Check for object matches
      for (const obj of intentData.objects) {
        for (const word of words) {
          const similarity = 1 - (this.levenshteinDistance(word, obj) / Math.max(word.length, obj.length));
          if (similarity >= 0.7) {
            objectMatches++;
            score += similarity * 0.5;
          }
          
          if (corrected.includes(obj)) {
            objectMatches++;
            score += 0.5;
          }
        }
      }
      
      // Calculate overall confidence
      if (keywordMatches > 0) {
        const confidence = score / (intentData.keywords.length + intentData.objects.length);
        if (confidence >= intentData.confidence && confidence > bestScore) {
          bestScore = confidence;
          bestIntent = {
            intent: intentName,
            confidence: confidence,
            keywordMatches,
            objectMatches
          };
        }
      }
    }
    
    return bestIntent;
  }

  /**
   * Extract file paths from text
   */
  extractFilePaths(text) {
    const paths = [];
    
    // Match absolute paths
    const absolutePattern = /(?:\/[^\s/]+)+/g;
    const absoluteMatches = text.match(absolutePattern);
    if (absoluteMatches) {
      paths.push(...absoluteMatches);
    }
    
    // Match relative paths
    const relativePattern = /(?:\.\/|\.\.\/)[\w\-./]+/g;
    const relativeMatches = text.match(relativePattern);
    if (relativeMatches) {
      paths.push(...relativeMatches);
    }
    
    // Match common file names
    const filePattern = /\b[\w\-]+\.[\w]+\b/g;
    const fileMatches = text.match(filePattern);
    if (fileMatches) {
      paths.push(...fileMatches);
    }
    
    return [...new Set(paths)]; // Remove duplicates
  }

  /**
   * Main interpretation method
   */
  interpret(text) {
    if (!text || text.trim().length === 0) {
      return { type: 'empty' };
    }

    // First, check for meta-commands
    const metaCommand = this.detectMetaCommand(text);
    if (metaCommand) {
      return { 
        type: 'meta_command', 
        ...metaCommand 
      };
    }

    // Apply Whisper corrections
    const correctedText = this.correctWhisperErrors(text);

    // Extract intent
    const intent = this.extractIntent(correctedText);

    // Extract file paths
    const filePaths = this.extractFilePaths(text);

    // If we detected an intent with reasonable confidence
    if (intent && intent.confidence >= 0.5) {
      return {
        type: 'task',
        original: text,
        corrected: correctedText,
        intent: intent.intent,
        confidence: intent.confidence,
        filePaths: filePaths,
        // Enhanced prompt for Claude with context
        enhancedPrompt: this.buildEnhancedPrompt(correctedText, intent, filePaths)
      };
    }

    // Default: treat as general conversation
    return {
      type: 'conversation',
      original: text,
      corrected: correctedText,
      filePaths: filePaths,
      enhancedPrompt: correctedText
    };
  }

  /**
   * Build enhanced prompt with context for Claude
   */
  buildEnhancedPrompt(text, intent, filePaths) {
    let prompt = text;
    
    // Add context based on intent
    if (intent) {
      const context = this.getIntentContext(intent.intent);
      if (context) {
        prompt = `${text}\n\n[Context: User likely wants to ${context}]`;
      }
    }

    // Add file path context
    if (filePaths.length > 0) {
      prompt += `\n[Detected file paths: ${filePaths.join(', ')}]`;
    }

    return prompt;
  }

  /**
   * Get human-readable context for an intent
   */
  getIntentContext(intentName) {
    const contexts = {
      file_read: 'read/view a file',
      file_write: 'create or edit a file',
      file_delete: 'delete a file or folder',
      file_list: 'list files in a directory',
      execute_command: 'run a command or script',
      search: 'find or search for something',
      install: 'install a package or dependency'
    };
    return contexts[intentName];
  }

  /**
   * Provide suggestions for ambiguous input
   */
  getSuggestions(text) {
    const corrected = this.correctWhisperErrors(text);
    const intent = this.extractIntent(corrected);
    
    if (!intent || intent.confidence < 0.5) {
      return [
        "Could you rephrase that?",
        "I'm not sure what you want me to do. Try being more specific.",
        "Did you want me to read, write, list, or execute something?"
      ];
    }

    return [];
  }
}

module.exports = NLPHandler;
