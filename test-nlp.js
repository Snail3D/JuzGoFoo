/**
 * Test suite for NLP Handler
 * Demonstrates fuzzy matching with imperfect Whisper transcriptions
 */

const NLPHandler = require('./nlp-handler');

const nlp = new NLPHandler();

console.log('🧪 Testing NLP Handler with Imperfect Transcriptions\n');
console.log('=' .repeat(70));

// Test cases: [imperfect input, expected behavior]
const testCases = [
  // File operations with errors
  { input: 'red the file server.js', expected: 'file_read' },
  { input: 'right a file called test.txt', expected: 'file_write' },
  { input: 'show me the contents of package.jason', expected: 'file_read' },
  { input: 'create a knew file', expected: 'file_write' },
  { input: 'the lead that file', expected: 'file_delete' },
  
  // Command execution with errors
  { input: 'exit cute npm install', expected: 'execute_command' },
  { input: 'one the server', expected: 'execute_command' },
  { input: 'in stall express', expected: 'install' },
  
  // Directory operations
  { input: 'missed the files in this folder', expected: 'file_list' },
  { input: 'so me whats in the directory', expected: 'file_list' },
  { input: 'list the contents of the older', expected: 'file_list' },
  
  // Search operations
  { input: 'fine the word todo in my code', expected: 'search' },
  { input: 'surge for package.json', expected: 'search' },
  { input: 'look for the function called mean', expected: 'search' },
  
  // Meta commands
  { input: 'clear the chat', expected: 'meta_command' },
  { input: 'start over', expected: 'meta_command' },
  { input: 'save this conversation', expected: 'meta_command' },
  { input: 'coffee that response', expected: 'meta_command' }, // "copy that response"
  
  // Natural queries
  { input: 'what files are here', expected: 'file_list' },
  { input: 'can you show me the code', expected: 'file_read' },
  { input: 'I want to make a new script', expected: 'file_write' },
  { input: 'help me find where I defined this function', expected: 'search' },
];

function runTests() {
  let passed = 0;
  let failed = 0;

  testCases.forEach((testCase, index) => {
    console.log(`\nTest ${index + 1}: "${testCase.input}"`);
    console.log('-'.repeat(70));
    
    const result = nlp.interpret(testCase.input);
    
    console.log(`Type: ${result.type}`);
    
    if (result.type === 'meta_command') {
      console.log(`Action: ${result.action}`);
      console.log(`Confidence: ${(result.confidence * 100).toFixed(1)}%`);
      if (testCase.expected === 'meta_command') {
        console.log('✅ PASS - Meta command detected');
        passed++;
      } else {
        console.log('❌ FAIL - Expected task intent');
        failed++;
      }
    } else if (result.type === 'task') {
      console.log(`Intent: ${result.intent}`);
      console.log(`Confidence: ${(result.confidence * 100).toFixed(1)}%`);
      console.log(`Corrected: "${result.corrected}"`);
      if (result.filePaths.length > 0) {
        console.log(`File paths: ${result.filePaths.join(', ')}`);
      }
      
      if (result.intent === testCase.expected) {
        console.log('✅ PASS - Correct intent detected');
        passed++;
      } else {
        console.log(`❌ FAIL - Expected ${testCase.expected}, got ${result.intent}`);
        failed++;
      }
    } else {
      console.log(`Intent: ${result.intent || 'conversation'}`);
      console.log(`Corrected: "${result.corrected}"`);
      if (testCase.expected === 'conversation') {
        console.log('✅ PASS - Treated as conversation');
        passed++;
      } else {
        console.log(`❌ FAIL - Expected ${testCase.expected}, got conversation`);
        failed++;
      }
    }
  });

  console.log('\n' + '='.repeat(70));
  console.log(`\n📊 Test Results: ${passed} passed, ${failed} failed out of ${testCases.length} tests`);
  console.log(`Success rate: ${((passed / testCases.length) * 100).toFixed(1)}%\n`);
}

// Run the tests
runTests();

// Interactive test
console.log('='.repeat(70));
console.log('\n💡 Try your own test:');
console.log('   node test-nlp.js "your test phrase here"\n');

if (process.argv[2]) {
  console.log('Testing custom input:', process.argv[2]);
  console.log('-'.repeat(70));
  const result = nlp.interpret(process.argv[2]);
  console.log(JSON.stringify(result, null, 2));
}
