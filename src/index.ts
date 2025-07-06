#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
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
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { URL } from 'url';
import { createTwoFilesPatch } from 'diff';

// Parse command line arguments for NPM usage
function parseCliArgs() {
  const args = process.argv.slice(2);
  
  // First try environment variables, then CLI args as fallback
  const config = {
    vaultPath: process.env.OBSIDIAN_VAULT_PATH || './vault',
    apiToken: process.env.OBSIDIAN_API_TOKEN || '',
    apiPort: process.env.OBSIDIAN_API_PORT || '27123',
    apiHost: process.env.OBSIDIAN_API_HOST || '127.0.0.1',
    transport: process.env.OBSIDIAN_TRANSPORT || 'stdio',
    httpPort: process.env.OBSIDIAN_HTTP_PORT || '3000',
    httpHost: process.env.OBSIDIAN_HTTP_HOST || '127.0.0.1',
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
    } else if (arg === '--transport' && i + 1 < args.length) {
      config.transport = args[i + 1];
      i++;
    } else if (arg === '--http-port' && i + 1 < args.length) {
      config.httpPort = args[i + 1];
      i++;
    } else if (arg === '--http-host' && i + 1 < args.length) {
      config.httpHost = args[i + 1];
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
  --transport <mode>    Transport mode: stdio or http (default: stdio)
  --http-port <port>    HTTP server port for SSE transport (default: 3000)
  --http-host <host>    HTTP server host for SSE transport (default: 127.0.0.1)
  --help, -h            Show this help message

Environment variables:
  OBSIDIAN_VAULT_PATH   Path to your Obsidian vault
  OBSIDIAN_API_TOKEN    API token for Obsidian Local REST API plugin
  OBSIDIAN_API_PORT     API port (default: 27123)
  OBSIDIAN_API_HOST     API host (default: 127.0.0.1)
  OBSIDIAN_TRANSPORT    Transport mode: stdio or http (default: stdio)
  OBSIDIAN_HTTP_PORT    HTTP server port for SSE transport (default: 3000)
  OBSIDIAN_HTTP_HOST    HTTP server host for SSE transport (default: 127.0.0.1)

Examples:
  obsidian-mcp --vault-path "/path/to/vault" --api-token "your-token"
  obsidian-mcp --transport http --http-port 8080 --vault-path "/path/to/vault"
  OBSIDIAN_VAULT_PATH="/path/to/vault" OBSIDIAN_API_TOKEN="token" obsidian-mcp
`);
      process.exit(0);
    }
  }

  return config;
}

// Helper functions for file editing
function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function createUnifiedDiff(originalContent: string, newContent: string, filepath: string): string {
  const normalizedOriginal = normalizeLineEndings(originalContent);
  const normalizedNew = normalizeLineEndings(newContent);
  
  return createTwoFilesPatch(
    filepath,
    filepath,
    normalizedOriginal,
    normalizedNew,
    'original',
    'modified'
  );
}

interface EditOperation {
  oldText: string;
  newText: string;
}

async function applyNoteEdits(filePath: string, edits: EditOperation[], dryRun: boolean = false): Promise<string> {
  const fullPath = path.join(VAULT_PATH, filePath);
  
  // Read current file content
  let content: string;
  try {
    content = fs.readFileSync(fullPath, 'utf-8');
  } catch (error) {
    throw new Error(`Failed to read file ${filePath}: ${error}`);
  }
  
  const originalContent = content;
  let modifiedContent = normalizeLineEndings(content);
  
  // Apply edits sequentially
  for (const edit of edits) {
    const { oldText, newText } = edit;
    
    if (oldText === newText) {
      continue; // Skip if no change
    }
    
    // Try exact match first
    if (modifiedContent.includes(oldText)) {
      modifiedContent = modifiedContent.replace(oldText, newText);
      continue;
    }
    
    // Try flexible line-by-line matching
    const oldLines = oldText.split('\n');
    const newLines = newText.split('\n');
    const contentLines = modifiedContent.split('\n');
    
    let matchFound = false;
    
    // Find matching sequence of lines
    for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
      let isMatch = true;
      const matchedIndentations: string[] = [];
      
      // Check if lines match (ignoring leading/trailing whitespace)
      for (let j = 0; j < oldLines.length; j++) {
        const contentLine = contentLines[i + j];
        const oldLine = oldLines[j];
        
        // Extract indentation from content line
        const indentMatch = contentLine.match(/^(\s*)/);
        const indentation = indentMatch ? indentMatch[1] : '';
        matchedIndentations.push(indentation);
        
        // Compare trimmed lines
        if (contentLine.trim() !== oldLine.trim()) {
          isMatch = false;
          break;
        }
      }
      
      if (isMatch) {
        // Replace the matched lines with new lines, preserving indentation
        const replacementLines = newLines.map((line, index) => {
          if (index < matchedIndentations.length) {
            const originalIndent = matchedIndentations[index];
            const lineWithoutIndent = line.replace(/^\s*/, '');
            return originalIndent + lineWithoutIndent;
          }
          return line;
        });
        
        // Replace the lines
        contentLines.splice(i, oldLines.length, ...replacementLines);
        modifiedContent = contentLines.join('\n');
        matchFound = true;
        break;
      }
    }
    
    if (!matchFound) {
      throw new Error(`Could not find matching text for edit: "${oldText.substring(0, 50)}..."`);
    }
  }
  
  if (dryRun) {
    // Return diff for preview
    return createUnifiedDiff(originalContent, modifiedContent, filePath);
  }
  
  // Write the modified content atomically
  const tempFile = fullPath + '.tmp';
  try {
    fs.writeFileSync(tempFile, modifiedContent, 'utf-8');
    fs.renameSync(tempFile, fullPath);
  } catch (error) {
    // Clean up temp file if it exists
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
    throw new Error(`Failed to write file ${filePath}: ${error}`);
  }
  
  return `File ${filePath} updated successfully`;
}

// Obsidian API configuration
const CONFIG = parseCliArgs();
const VAULT_PATH = CONFIG.vaultPath;
const API_TOKEN = CONFIG.apiToken;
const API_PORT = CONFIG.apiPort;
const API_HOST = CONFIG.apiHost;
const API_BASE_URL = `http://${API_HOST}:${API_PORT}`;
const TRANSPORT_MODE = CONFIG.transport;
const HTTP_PORT = parseInt(CONFIG.httpPort);
const HTTP_HOST = CONFIG.httpHost;

// Debug logging for configuration
console.error(`[DEBUG] Command line args: ${JSON.stringify(process.argv)}`);
console.error(`[DEBUG] Environment variables:`);
console.error(`[DEBUG] - OBSIDIAN_VAULT_PATH: ${process.env.OBSIDIAN_VAULT_PATH || 'NOT SET'}`);
console.error(`[DEBUG] - OBSIDIAN_API_TOKEN: ${process.env.OBSIDIAN_API_TOKEN ? 'SET' : 'NOT SET'}`);
console.error(`[DEBUG] - OBSIDIAN_TRANSPORT: ${process.env.OBSIDIAN_TRANSPORT || 'NOT SET'}`);
console.error(`[DEBUG] Parsed configuration:`);
console.error(`[DEBUG] - Vault Path: ${VAULT_PATH}`);
console.error(`[DEBUG] - API Base URL: ${API_BASE_URL}`);
console.error(`[DEBUG] - API Token: ${API_TOKEN ? API_TOKEN.substring(0, 8) + '...' : 'NOT SET'}`);
console.error(`[DEBUG] - Transport Mode: ${TRANSPORT_MODE}`);
console.error(`[DEBUG] - HTTP Server: ${HTTP_HOST}:${HTTP_PORT}`);

// Validate vault path exists
if (!fs.existsSync(VAULT_PATH)) {
  console.error(`[ERROR] Vault path does not exist: ${VAULT_PATH}`);
  console.error(`[ERROR] Please check your vault path configuration`);
  console.error(`[ERROR] Current working directory: ${process.cwd()}`);
}

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
      timeout: 10000, // 10 second timeout
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
        {
          name: 'update_note',
          description: 'Update content in an existing note using targeted text replacements',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Path to the note within the vault'
              },
              edits: {
                type: 'array',
                description: 'Array of edit operations to apply',
                items: {
                  type: 'object',
                  properties: {
                    oldText: {
                      type: 'string',
                      description: 'Text to search for and replace (must match exactly)'
                    },
                    newText: {
                      type: 'string',
                      description: 'Text to replace with'
                    }
                  },
                  required: ['oldText', 'newText']
                }
              },
              dryRun: {
                type: 'boolean',
                description: 'Preview changes using git-style diff format without applying them',
                default: false
              }
            },
            required: ['path', 'edits'],
          },
        },
        {
          name: 'read_multiple_notes',
          description: 'Read content from multiple notes simultaneously',
          inputSchema: {
            type: 'object',
            properties: {
              paths: {
                type: 'array',
                description: 'Array of note paths to read',
                items: {
                  type: 'string'
                }
              }
            },
            required: ['paths'],
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
          case 'search_vault':
            return await this.handleSearchVault(request.params.arguments);
          case 'delete_note':
            return await this.handleDeleteNote(request.params.arguments);
          case 'move_note':
            return await this.handleMoveNote(request.params.arguments);
          case 'manage_folder':
            return await this.handleManageFolder(request.params.arguments);
          case 'update_note':
            return await this.handleUpdateNote(request.params.arguments);
          case 'read_multiple_notes':
            return await this.handleReadMultipleNotes(request.params.arguments);
          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${request.params.name}`
            );
        }
      } catch (error) {
        console.error(`Error executing tool ${request.params.name}:`, error);
        throw new McpError(
          ErrorCode.InternalError,
          `${error instanceof Error ? error.message : String(error)}`
        );
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

  // Handler for update_note tool
  private async handleUpdateNote(args: any) {
    if (!args?.path || !args?.edits) {
      throw new Error('Path and edits are required');
    }
    
    if (!Array.isArray(args.edits)) {
      throw new Error('Edits must be an array');
    }
    
    const dryRun = args.dryRun || false;
    const result = await applyNoteEdits(args.path, args.edits, dryRun);
    
    return {
      content: [
        {
          type: 'text',
          text: result,
        },
      ],
    };
  }

  // Handler for read_multiple_notes tool
  private async handleReadMultipleNotes(args: any) {
    if (!args?.paths) {
      throw new Error('Paths are required');
    }
    
    if (!Array.isArray(args.paths)) {
      throw new Error('Paths must be an array');
    }
    
    const results = await Promise.all(
      args.paths.map(async (notePath: string) => {
        try {
          const content = await this.readNote(notePath);
          return `${notePath}:\n${content}\n`;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return `${notePath}: Error - ${errorMessage}`;
        }
      })
    );
    
    return {
      content: [
        {
          type: 'text',
          text: results.join('\n---\n'),
        },
      ],
    };
  }

  // Obsidian API methods
  private async listVaultFiles(folder: string = ''): Promise<string[]> {
    try {
      // First try using the Obsidian API
      const response = await this.api.get('/vault/');
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
      // First try using the Obsidian API - using standard file operations
      // Most Obsidian Local REST API implementations don't support direct move operations
      // So we'll read the source file and create it at the destination, then delete the source
      
      // Read source file content via API
      const sourceResponse = await this.api.get(`/vault/${encodeURIComponent(sourcePath)}`);
      const content = sourceResponse.data.content || '';
      
      // Create destination file via API
      await this.api.post(`/vault/${encodeURIComponent(destinationPath)}`, { content });
      
      // Delete source file via API
      await this.api.delete(`/vault/${encodeURIComponent(sourcePath)}`);
      
    } catch (error) {
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
      try {
        fs.renameSync(sourceFullPath, destFullPath);
      } catch (renameError) {
        throw new Error(`Failed to move file: ${renameError}`);
      }
      
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
    if (TRANSPORT_MODE === 'http') {
      await this.startHttpServer();
    } else {
      await this.startStdioServer();
    }
  }

  private async startStdioServer() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Obsidian MCP server running on stdio');
  }

  private async startHttpServer() {
    const httpServer = createServer();
    const activeTransports = new Map<string, SSEServerTransport>();

    httpServer.on('request', async (req: IncomingMessage, res: ServerResponse) => {
      try {
        const url = new URL(req.url!, `http://${req.headers.host}`);
        const path = url.pathname;
        const sessionId = url.searchParams.get('sessionId');

        // CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        if (req.method === 'OPTIONS') {
          res.writeHead(200);
          res.end();
          return;
        }

        if (path === '/sse' && req.method === 'GET') {
          // Set SSE headers before creating transport
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');
          
          // Handle SSE connection
          const transport = new SSEServerTransport('/messages', res);
          await this.server.connect(transport);
          activeTransports.set(transport.sessionId, transport);
          
          console.error(`[INFO] SSE connection established with session ID: ${transport.sessionId}`);
          
          // Clean up when connection closes
          transport.onclose = () => {
            activeTransports.delete(transport.sessionId);
            console.error(`[INFO] SSE connection closed for session ID: ${transport.sessionId}`);
          };
          
        } else if (path === '/messages' && req.method === 'POST') {
          // Handle POST messages
          if (!sessionId) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Missing sessionId parameter');
            return;
          }

          const transport = activeTransports.get(sessionId);
          if (!transport) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Session not found');
            return;
          }

          await transport.handlePostMessage(req, res);
          
        } else {
          // Handle other requests
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not found');
        }
      } catch (error) {
        console.error('HTTP request error:', error);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal server error');
      }
    });

    httpServer.listen(HTTP_PORT, HTTP_HOST, () => {
      console.error(`[INFO] Obsidian MCP server running on HTTP ${HTTP_HOST}:${HTTP_PORT}`);
      console.error(`[INFO] SSE endpoint: http://${HTTP_HOST}:${HTTP_PORT}/sse`);
      console.error(`[INFO] Messages endpoint: http://${HTTP_HOST}:${HTTP_PORT}/messages`);
    });
  }
}

// Validate transport mode
if (TRANSPORT_MODE !== 'stdio' && TRANSPORT_MODE !== 'http') {
  console.error(`[ERROR] Invalid transport mode: ${TRANSPORT_MODE}. Must be 'stdio' or 'http'`);
  process.exit(1);
}

// Create and run the server
const server = new ObsidianMcpServer();
server.run().catch(console.error);
