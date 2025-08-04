#!/usr/bin/env node

// Test script for recursive listing feature
const { spawn } = require('child_process');
const path = require('path');

// Configuration
const VAULT_PATH = process.env.OBSIDIAN_VAULT_PATH || '/path/to/vault';
const API_TOKEN = process.env.OBSIDIAN_API_TOKEN || 'your-token';

console.log('Testing Obsidian MCP Server - Recursive Listing Feature\n');

// Start the server
const server = spawn('node', [
  path.join(__dirname, 'build/index.js'),
  '--vault-path', VAULT_PATH,
  '--api-token', API_TOKEN
], {
  stdio: ['pipe', 'pipe', 'pipe']
});

// Helper function to send MCP request
function sendRequest(request) {
  return new Promise((resolve, reject) => {
    let response = '';
    
    server.stdout.on('data', (data) => {
      response += data.toString();
      try {
        const lines = response.split('\n');
        for (const line of lines) {
          if (line.trim()) {
            const parsed = JSON.parse(line);
            if (parsed.result) {
              resolve(parsed.result);
            }
          }
        }
      } catch (e) {
        // Continue collecting data
      }
    });
    
    server.stderr.on('data', (data) => {
      console.error('Server error:', data.toString());
    });
    
    server.stdin.write(JSON.stringify(request) + '\n');
  });
}

// Test cases
async function runTests() {
  try {
    // Wait for server to initialize
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('Test 1: List all notes recursively (default behavior)');
    const test1 = await sendRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'list_notes',
        arguments: {}
      }
    });
    console.log('Result:', JSON.stringify(test1, null, 2));
    console.log('\n---\n');
    
    console.log('Test 2: List notes in root folder only (recursive: false)');
    const test2 = await sendRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'list_notes',
        arguments: {
          recursive: false
        }
      }
    });
    console.log('Result:', JSON.stringify(test2, null, 2));
    console.log('\n---\n');
    
    console.log('Test 3: List notes in specific folder recursively');
    const test3 = await sendRequest({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'list_notes',
        arguments: {
          folder: 'subfolder',
          recursive: true
        }
      }
    });
    console.log('Result:', JSON.stringify(test3, null, 2));
    console.log('\n---\n');
    
    console.log('Test 4: List notes in specific folder non-recursively');
    const test4 = await sendRequest({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'list_notes',
        arguments: {
          folder: 'subfolder',
          recursive: false
        }
      }
    });
    console.log('Result:', JSON.stringify(test4, null, 2));
    
  } catch (error) {
    console.error('Test error:', error);
  } finally {
    // Clean up
    server.kill();
    process.exit(0);
  }
}

// Run the tests
runTests();