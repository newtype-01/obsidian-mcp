#!/usr/bin/env node

import inquirer from 'inquirer';
import keychain from 'keychain';

const SERVICE_NAME = 'com.mcp.obsidian-mcp';
const ACCOUNT_NAME = 'OBSIDIAN_API_TOKEN';

async function setup() {
  console.log('🔐 Obsidian MCP Token Setup');
  console.log('This will securely store your Obsidian API token in your system keychain.');
  console.log('');

  try {
    // Check if token already exists
    keychain.getPassword({ 
      account: ACCOUNT_NAME, 
      service: SERVICE_NAME 
    }, async (err, existingToken) => {
      if (!err && existingToken) {
        console.log('✅ API token already exists in keychain.');
        
        const { overwrite } = await inquirer.prompt([{
          type: 'confirm',
          name: 'overwrite',
          message: 'Do you want to overwrite the existing token?',
          default: false
        }]);

        if (!overwrite) {
          console.log('Setup cancelled. Existing token preserved.');
          process.exit(0);
        }
      }

      // Prompt for new token
      const answers = await inquirer.prompt([
        {
          type: 'password',
          name: 'apiToken',
          message: 'Enter your Obsidian API token:',
          mask: '*',
          validate: (input) => {
            if (!input || input.trim().length === 0) {
              return 'API token cannot be empty';
            }
            return true;
          }
        }
      ]);

      const { apiToken } = answers;

      // Store the token in keychain
      keychain.setPassword({
        account: ACCOUNT_NAME,
        service: SERVICE_NAME,
        password: apiToken.trim()
      }, (err) => {
        if (err) {
          console.error('❌ Failed to store API token in keychain:', err.message);
          process.exit(1);
        }

        console.log('✅ API token stored successfully in system keychain!');
        console.log('');
        console.log('The token is now stored securely under:');
        console.log(`   Service: ${SERVICE_NAME}`);
        console.log(`   Account: ${ACCOUNT_NAME}`);
        console.log('');
        console.log('You can now run obsidian-mcp without setting the OBSIDIAN_API_TOKEN environment variable.');
        
        process.exit(0);
      });
    });

  } catch (error) {
    console.error('❌ Setup failed:', error.message);
    process.exit(1);
  }
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  console.log('\n\nSetup cancelled by user.');
  process.exit(0);
});

setup();
