#!/usr/bin/env node

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test configuration
const testConfig = {
  vaultPath: '/Users/huangyihe/Desktop/test',
  apiToken: 'e93630ea923a2fcc908e215dc16cf1ddd3d3f916f69c7de2e6b1cf18b4b7d549',
  apiPort: '27123',
  apiHost: '127.0.0.1'
};

console.log('🧪 Testing move_note functionality...');
console.log('📍 Test configuration:');
console.log(`   Vault Path: ${testConfig.vaultPath}`);
console.log(`   API Host: ${testConfig.apiHost}:${testConfig.apiPort}`);
console.log(`   API Token: ${testConfig.apiToken.substring(0, 8)}...`);
console.log('');

// Function to send MCP request
function sendMCPRequest(request) {
  return new Promise((resolve, reject) => {
    const serverPath = path.join(__dirname, 'build', 'index.js');
    
    const child = spawn('node', [
      serverPath,
      '--vault-path', testConfig.vaultPath,
      '--api-token', testConfig.apiToken,
      '--api-port', testConfig.apiPort,
      '--api-host', testConfig.apiHost
    ], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Process exited with code ${code}\nSTDERR: ${stderr}`));
      } else {
        resolve({ stdout, stderr });
      }
    });

    child.on('error', (error) => {
      reject(error);
    });

    // Send MCP request
    child.stdin.write(JSON.stringify(request) + '\n');
    child.stdin.end();

    // Add timeout
    setTimeout(() => {
      child.kill();
      reject(new Error('Request timed out after 30 seconds'));
    }, 30000);
  });
}

// Test move_note operation
async function testMoveNote() {
  console.log('🔄 Testing move_note operation...');
  
  const moveRequest = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'move_note',
      arguments: {
        sourcePath: 'test/Welcome.md',
        destinationPath: '123/Welcome.md'
      }
    }
  };

  try {
    console.log('📤 Sending move_note request...');
    console.log('   Source: test/Welcome.md');
    console.log('   Destination: 123/Welcome.md');
    
    const result = await sendMCPRequest(moveRequest);
    
    console.log('✅ Move operation completed!');
    console.log('📊 Server response:');
    console.log(result.stdout);
    
    if (result.stderr) {
      console.log('🔍 Debug logs:');
      console.log(result.stderr);
    }
    
  } catch (error) {
    console.error('❌ Move operation failed:');
    console.error(error.message);
    
    // Try to extract more detailed error info
    if (error.message.includes('STDERR:')) {
      const stderrMatch = error.message.match(/STDERR: (.*)/s);
      if (stderrMatch) {
        console.error('🔍 Server error details:');
        console.error(stderrMatch[1]);
      }
    }
  }
}

// Run the test
testMoveNote().then(() => {
  console.log('🏁 Test completed');
}).catch((error) => {
  console.error('💥 Test failed:', error);
  process.exit(1);
});