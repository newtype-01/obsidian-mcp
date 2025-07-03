#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import axios, { AxiosInstance } from 'axios';
import * as path from 'path';
import * as fs from 'fs';

// Parse command line arguments for NPM usage
function parseCliArgs() {
  const args = process.argv.slice(2);
  const config = {
    vaultPath: process.env.OBSIDIAN_VAULT_PATH || './vault',
    apiToken: process.env.OBSIDIAN_API_TOKEN || '',
    apiPort: process.env.OBSIDIAN_API_PORT || '27123',
    apiHost: process.env.OBSIDIAN_API_HOST || '127.0.0.1',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--vault-path' && i + 1 < args.length) {
      config.vaultPath = args[i + 1];
      i++;
    } else if (arg === '--api-token' && i + 1 < args.length) {
      config.apiToken = args[i + 1];
      i++;
    } else if (arg === '--api-port' && i + 1 < args.length) {
      config.apiPort = args[i + 1];
      i++;
    } else if (arg === '--api-host' && i + 1 < args.length) {
      config.apiHost = args[i + 1];
      i++;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Obsidian MCP Server

Usage: obsidian-mcp [options]

Options:
  --vault-path <path>   Path to your Obsidian vault
  --api-token <token>   API token for Obsidian Local REST API plugin
  --api-port <port>     API port (default: 27123)
  --api-host <host>     API host (default: 127.0.0.1)
  --help, -h            Show this help message

Environment variables:
  OBSIDIAN_VAULT_PATH   Path to your Obsidian vault
  OBSIDIAN_API_TOKEN    API token for Obsidian Local REST API plugin
  OBSIDIAN_API_PORT     API port (default: 27123)
  OBSIDIAN_API_HOST     API host (default: 127.0.0.1)

Examples:
  obsidian-mcp --vault-path "/path/to/vault" --api-token "your-token"
  OBSIDIAN_VAULT_PATH="/path/to/vault" OBSIDIAN_API_TOKEN="token" obsidian-mcp
`);
      process.exit(0);
    }
  }

  return config;
}

// Obsidian API configuration
const CONFIG = parseCliArgs();
const VAULT_PATH = CONFIG.vaultPath;
const API_TOKEN = CONFIG.apiToken;
const API_PORT = CONFIG.apiPort;
const API_HOST = CONFIG.apiHost;
const API_BASE_URL = `http://${API_HOST}:${API_PORT}`;

class ObsidianMcpServer {
  private server: Server;
  private api: AxiosInstance;

  constructor() {
    // Initialize MCP server
    this.server = new Server(
      {
        name: 'obsidian-mcp-server',
        version: '0.1.0',
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        },
      }
    );

    // Initialize Obsidian API client
    this.api = axios.create({
      baseURL: API_BASE_URL,
      headers: {
        'Authorization': `Bearer ${API_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    // Set up request handlers
    this.setupResourceHandlers();
    this.setupToolHandlers();
    
    // Error handling
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupResourceHandlers() {
    // List available resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      try {
        // Get list of files in the vault
        const files = await this.listVaultFiles();
        
        // Map files to resources
        const resources = files.map(file => ({
          uri: `obsidian://${encodeURIComponent(file)}`,
          name: path.basename(file),
          mimeType: 'text/markdown',
          description: `Markdown note: ${file}`,
        }));
        
        return { resources };
      } catch (error) {
        console.error('Error listing resources:', error);
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to list resources: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });

    // Read resource content
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      try {
        const match = request.params.uri.match(/^obsidian:\/\/(.+)$/);
        if (!match) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            `Invalid URI format: ${request.params.uri}`
          );
        }
        
        const filePath = decodeURIComponent(match[1]);
        const content = await this.readNote(filePath);
        
        return {
          contents: [
            {
              uri: request.params.uri,
              mimeType: 'text/markdown',
              text: content,
            },
          ],
        };
      } catch (error) {
        console.error('Error reading resource:', error);
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to read resource: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });
  }

  private setupToolHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'list_notes',
          description: 'List all notes in the Obsidian vault',
          inputSchema: {
            type: 'object',
            properties: {
              folder: {
                type: 'string',
                description: 'Folder path within the vault (optional)',
              },
            },
            required: [],
          },
        },
        {
          name: 'delete_note',
          description: 'Delete a note from the Obsidian vault',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Path to the note within the vault',
              },
            },
            required: ['path'],
          },
        },
        {
          name: 'read_note',
          description: 'Read the content of a note in the Obsidian vault',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Path to the note within the vault',
              },
            },
            required: ['path'],
          },
        },
        {
          name: 'create_note',
          description: 'Create a new note in the Obsidian vault',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Path where the note should be created',
              },
              content: {
                type: 'string',
                description: 'Content of the note',
              },
            },
            required: ['path', 'content'],
          },
        },
        {
          name: 'update_note',
          description: 'Update an existing note in the Obsidian vault',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Path to the note within the vault',
              },
              content: {
                type: 'string',
                description: 'New content of the note',
              },
            },
            required: ['path', 'content'],
          },
        },
        {
          name: 'search_vault',
          description: 'Search for content in the Obsidian vault',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Search query',
              },
            },
            required: ['query'],
          },
        },
        {
          name: 'move_note',
          description: 'Move or rename a note to a new location in the Obsidian vault',
          inputSchema: {
            type: 'object',
            properties: {
              sourcePath: {
                type: 'string',
                description: 'Current path to the note within the vault',
              },
              destinationPath: {
                type: 'string',
                description: 'New path where the note should be moved',
              },
            },
            required: ['sourcePath', 'destinationPath'],
          },
        },
        {
          name: 'manage_folder',
          description: 'Create, rename, move, or delete a folder in the Obsidian vault',
          inputSchema: {
            type: 'object',
            properties: {
              operation: {
                type: 'string',
                description: 'The operation to perform: create, rename, move, or delete',
                enum: ['create', 'rename', 'move', 'delete']
              },
              path: {
                type: 'string',
                description: 'Path to the folder within the vault'
              },
              newPath: {
                type: 'string',
                description: 'New path for the folder (required for rename and move operations)'
              }
            },
            required: ['operation', 'path'],
          },
        },
      ],
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        switch (request.params.name) {
          case 'list_notes':
            return await this.handleListNotes(request.params.arguments);
          case 'read_note':
            return await this.handleReadNote(request.params.arguments);
          case 'create_note':
            return await this.handleCreateNote(request.params.arguments);
          case 'update_note':
            return await this.handleUpdateNote(request.params.arguments);
          case 'search_vault':
            return await this.handleSearchVault(request.params.arguments);
          case 'delete_note':
            return await this.handleDeleteNote(request.params.arguments);
          case 'move_note':
            return await this.handleMoveNote(request.params.arguments);
          case 'manage_folder':
            return await this.handleManageFolder(request.params.arguments);
          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${request.params.name}`
            );
        }
      } catch (error) {
        console.error(`Error executing tool ${request.params.name}:`, error);
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  // Tool handler implementations
  private async handleListNotes(args: any) {
    const folder = args?.folder || '';
    const files = await this.listVaultFiles(folder);
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(files, null, 2),
        },
      ],
    };
  }

  private async handleReadNote(args: any) {
    if (!args?.path) {
      throw new Error('Path is required');
    }
    
    const content = await this.readNote(args.path);
    
    return {
      content: [
        {
          type: 'text',
          text: content,
        },
      ],
    };
  }

  private async handleCreateNote(args: any) {
    if (!args?.path || !args?.content) {
      throw new Error('Path and content are required');
    }
    
    await this.createNote(args.path, args.content);
    
    return {
      content: [
        {
          type: 'text',
          text: `Note created successfully at ${args.path}`,
        },
      ],
    };
  }

  private async handleUpdateNote(args: any) {
    if (!args?.path || !args?.content) {
      throw new Error('Path and content are required');
    }
    
    await this.updateNote(args.path, args.content);
    
    return {
      content: [
        {
          type: 'text',
          text: `Note updated successfully at ${args.path}`,
        },
      ],
    };
  }

  private async handleSearchVault(args: any) {
    if (!args?.query) {
      throw new Error('Search query is required');
    }
    
    const results = await this.searchVault(args.query);
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(results, null, 2),
        },
      ],
    };
  }

  private async handleDeleteNote(args: any) {
    if (!args?.path) {
      throw new Error('Path is required');
    }
    
    await this.deleteNote(args.path);
    
    return {
      content: [
        {
          type: 'text',
          text: `Note deleted successfully: ${args.path}`,
        },
      ],
    };
  }

  private async handleMoveNote(args: any) {
    if (!args?.sourcePath || !args?.destinationPath) {
      throw new Error('Source path and destination path are required');
    }
    
    await this.moveNote(args.sourcePath, args.destinationPath);
    
    return {
      content: [
        {
          type: 'text',
          text: `Note moved successfully from ${args.sourcePath} to ${args.destinationPath}`,
        },
      ],
    };
  }

  // Tool handler for folder operations
  private async handleManageFolder(args: any) {
    if (!args?.operation || !args?.path) {
      throw new Error('Operation and path are required');
    }
    
    const operation = args.operation;
    const folderPath = args.path;
    const newPath = args.newPath;
    
    switch (operation) {
      case 'create':
        await this.createFolder(folderPath);
        return {
          content: [
            {
              type: 'text',
              text: `Folder created successfully at ${folderPath}`,
            },
          ],
        };
      
      case 'rename':
        if (!newPath) {
          throw new Error('New path is required for rename operation');
        }
        await this.renameFolder(folderPath, newPath);
        return {
          content: [
            {
              type: 'text',
              text: `Folder renamed from ${folderPath} to ${newPath}`,
            },
          ],
        };
      
      case 'move':
        if (!newPath) {
          throw new Error('New path is required for move operation');
        }
        await this.moveFolder(folderPath, newPath);
        return {
          content: [
            {
              type: 'text',
              text: `Folder moved from ${folderPath} to ${newPath}`,
            },
          ],
        };
      
      case 'delete':
        await this.deleteFolder(folderPath);
        return {
          content: [
            {
              type: 'text',
              text: `Folder deleted successfully: ${folderPath}`,
            },
          ],
        };
      
      default:
        throw new Error(`Unknown folder operation: ${operation}`);
    }
  }

  // Obsidian API methods
  private async listVaultFiles(folder: string = ''): Promise<string[]> {
    try {
      // First try using the Obsidian API
      const response = await this.api.get('/vault');
      return response.data.files || [];
    } catch (error) {
      console.warn('API request failed, falling back to file system:', error);
      
      // Fallback to file system if API fails
      const basePath = path.join(VAULT_PATH, folder);
      return this.listFilesRecursively(basePath);
    }
  }

  private listFilesRecursively(dir: string): string[] {
    const files: string[] = [];
    
    const items = fs.readdirSync(dir);
    
    for (const item of items) {
      if (item === '.obsidian' || item === '.git' || item === '.DS_Store') {
        continue;
      }
      
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);
      
      if (stat.isDirectory()) {
        files.push(...this.listFilesRecursively(fullPath));
      } else if (item.endsWith('.md')) {
        // Get path relative to vault
        const relativePath = path.relative(VAULT_PATH, fullPath);
        files.push(relativePath);
      }
    }
    
    return files;
  }

  private async readNote(notePath: string): Promise<string> {
    try {
      // First try using the Obsidian API
      const response = await this.api.get(`/vault/${encodeURIComponent(notePath)}`);
      return response.data.content || '';
    } catch (error) {
      console.warn('API request failed, falling back to file system:', error);
      
      // Fallback to file system if API fails
      const fullPath = path.join(VAULT_PATH, notePath);
      return fs.readFileSync(fullPath, 'utf-8');
    }
  }

  private async createNote(notePath: string, content: string): Promise<void> {
    try {
      // First try using the Obsidian API
      await this.api.post(`/vault/${encodeURIComponent(notePath)}`, { content });
    } catch (error) {
      console.warn('API request failed, falling back to file system:', error);
      
      // Fallback to file system if API fails
      const fullPath = path.join(VAULT_PATH, notePath);
      const dir = path.dirname(fullPath);
      
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      fs.writeFileSync(fullPath, content, 'utf-8');
    }
  }

  private async updateNote(notePath: string, content: string): Promise<void> {
    try {
      // First try using the Obsidian API
      await this.api.put(`/vault/${encodeURIComponent(notePath)}`, { content });
    } catch (error) {
      console.warn('API request failed, falling back to file system:', error);
      
      // Fallback to file system if API fails
      const fullPath = path.join(VAULT_PATH, notePath);
      
      if (!fs.existsSync(fullPath)) {
        throw new Error(`Note not found: ${notePath}`);
      }
      
      fs.writeFileSync(fullPath, content, 'utf-8');
    }
  }

  private async searchVault(query: string): Promise<any[]> {
    try {
      // First try using the Obsidian API
      const response = await this.api.get(`/search?query=${encodeURIComponent(query)}`);
      return response.data.results || [];
    } catch (error) {
      console.warn('API request failed, falling back to simple search:', error);
      
      // Fallback to simple search if API fails
      const files = await this.listVaultFiles();
      const results = [];
      
      for (const file of files) {
        const content = await this.readNote(file);
        
        if (content.toLowerCase().includes(query.toLowerCase())) {
          results.push({
            path: file,
            score: 1,
            matches: [{ line: content.split('\n').findIndex(line => line.toLowerCase().includes(query.toLowerCase())) }],
          });
        }
      }
      
      return results;
    }
  }

  private async deleteNote(notePath: string): Promise<void> {
    try {
      // First try using the Obsidian API
      await this.api.delete(`/vault/${encodeURIComponent(notePath)}`);
    } catch (error) {
      console.warn('API request failed, falling back to file system:', error);
      
      // Fallback to file system if API fails
      const fullPath = path.join(VAULT_PATH, notePath);
      
      if (!fs.existsSync(fullPath)) {
        throw new Error(`Note not found: ${notePath}`);
      }
      
      fs.unlinkSync(fullPath);
      
      // Check if parent directory is empty and remove it if it is
      const dir = path.dirname(fullPath);
      if (dir !== VAULT_PATH) {
        const items = fs.readdirSync(dir);
        if (items.length === 0) {
          fs.rmdirSync(dir);
        }
      }
    }
  }

  private async moveNote(sourcePath: string, destinationPath: string): Promise<void> {
    try {
      // First try using the Obsidian API if it supports file moving
      // Note: Check if Obsidian Local REST API supports direct file moving
      await this.api.put(`/vault/${encodeURIComponent(sourcePath)}/move`, { 
        newPath: destinationPath 
      });
    } catch (error) {
      console.warn('API request failed, falling back to file system:', error);
      
      // Fallback to file system operations
      const sourceFullPath = path.join(VAULT_PATH, sourcePath);
      const destFullPath = path.join(VAULT_PATH, destinationPath);
      
      // Validate source file exists
      if (!fs.existsSync(sourceFullPath)) {
        throw new Error(`Source note not found: ${sourcePath}`);
      }
      
      // Check if destination already exists
      if (fs.existsSync(destFullPath)) {
        throw new Error(`Destination already exists: ${destinationPath}`);
      }
      
      // Create destination directory if it doesn't exist
      const destDir = path.dirname(destFullPath);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }
      
      // Use filesystem rename (works for all file types including PDF)
      fs.renameSync(sourceFullPath, destFullPath);
      
      // Clean up empty source directory if needed
      const sourceDir = path.dirname(sourceFullPath);
      if (sourceDir !== VAULT_PATH) {
        try {
          const items = fs.readdirSync(sourceDir);
          if (items.length === 0) {
            fs.rmdirSync(sourceDir);
          }
        } catch (error) {
          // Ignore errors when cleaning up empty directories
          console.warn('Could not clean up empty source directory:', error);
        }
      }
    }
  }

  // Folder operation methods
  private async createFolder(folderPath: string): Promise<void> {
    try {
      // First try using the Obsidian API
      await this.api.post(`/folders/${encodeURIComponent(folderPath)}`);
    } catch (error) {
      console.warn('API request failed, falling back to file system:', error);
      
      // Fallback to file system if API fails
      const fullPath = path.join(VAULT_PATH, folderPath);
      
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
      }
    }
  }

  private async renameFolder(folderPath: string, newPath: string): Promise<void> {
    try {
      // First try using the Obsidian API
      await this.api.put(`/folders/${encodeURIComponent(folderPath)}`, { newPath });
    } catch (error) {
      console.warn('API request failed, falling back to file system:', error);
      
      // Fallback to file system if API fails
      const fullPath = path.join(VAULT_PATH, folderPath);
      const newFullPath = path.join(VAULT_PATH, newPath);
      
      if (!fs.existsSync(fullPath)) {
        throw new Error(`Folder not found: ${folderPath}`);
      }
      
      if (fs.existsSync(newFullPath)) {
        throw new Error(`Destination folder already exists: ${newPath}`);
      }
      
      // Create parent directory if it doesn't exist
      const parentDir = path.dirname(newFullPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      
      fs.renameSync(fullPath, newFullPath);
    }
  }

  private async moveFolder(folderPath: string, newPath: string): Promise<void> {
    // Move is essentially the same as rename in this context
    await this.renameFolder(folderPath, newPath);
  }

  private async deleteFolder(folderPath: string): Promise<void> {
    try {
      // First try using the Obsidian API
      await this.api.delete(`/folders/${encodeURIComponent(folderPath)}`);
    } catch (error) {
      console.warn('API request failed, falling back to file system:', error);
      
      // Fallback to file system if API fails
      const fullPath = path.join(VAULT_PATH, folderPath);
      
      if (!fs.existsSync(fullPath)) {
        throw new Error(`Folder not found: ${folderPath}`);
      }
      
      // Recursively delete the folder and its contents
      this.deleteFolderRecursive(fullPath);
    }
  }

  private deleteFolderRecursive(folderPath: string): void {
    if (fs.existsSync(folderPath)) {
      fs.readdirSync(folderPath).forEach((file) => {
        const curPath = path.join(folderPath, file);
        if (fs.lstatSync(curPath).isDirectory()) {
          // Recursive call for directories
          this.deleteFolderRecursive(curPath);
        } else {
          // Delete file
          fs.unlinkSync(curPath);
        }
      });
      // Delete empty directory
      fs.rmdirSync(folderPath);
    }
  }

  // Start the server
  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Obsidian MCP server running on stdio');
  }
}

// Create and run the server
const server = new ObsidianMcpServer();
server.run().catch(console.error);
