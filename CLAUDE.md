# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an Obsidian MCP (Model Context Protocol) server that enables AI models to interact with Obsidian knowledge bases. The server provides tools for reading, creating, updating, and deleting notes, as well as managing folder structures and searching vault content.

## Architecture

- **Main Server**: `src/index.ts` - Single-file TypeScript implementation using the MCP SDK
- **Core Class**: `ObsidianMcpServer` - Handles all MCP protocol operations and Obsidian API interactions
- **Dual API Strategy**: Primary Obsidian REST API calls with filesystem fallback for reliability
- **Transport**: Uses stdio transport for MCP communication
- **Environment Configuration**: Uses dotenv for API tokens and vault paths

## Development Commands

```bash
# Build the project
npm run build

# Run in development mode
npm run dev

# Start the server
npm start

# Run tests
npm test
```

## Key Components

### MCP Tools Available:
- `list_notes` - List all notes in vault (with optional folder filtering)
- `read_note` - Read specific note content  
- `create_note` - Create new notes
- `search_vault` - Smart search across vault (filename + content, all file types)
- `delete_note` - Delete notes
- `move_note` - Move/rename notes to new locations (filesystem-level operations, supports all file types including PDF, images, and large files without content copying)
- `manage_folder` - CRUD operations for folders (create/rename/move/delete)
- `update_note` - Update content in existing notes using targeted text replacements
- `read_multiple_notes` - Read content from multiple notes simultaneously
- `auto_backlink_vault` - **NEW**: Automatically add backlinks throughout the entire vault by detecting note names in content and converting them to wikilinks

### Environment Variables:
- `OBSIDIAN_VAULT_PATH` - Path to the Obsidian vault
- `OBSIDIAN_API_TOKEN` - API token for Obsidian Local REST API plugin
- `OBSIDIAN_API_PORT` - Port for Obsidian API (default: 27123)

### Error Handling:
- Graceful fallback from Obsidian API to direct filesystem operations
- Proper MCP error responses with appropriate error codes
- Comprehensive logging for debugging

## Dependencies

- `@modelcontextprotocol/sdk` - Core MCP protocol implementation
- `axios` - HTTP client for Obsidian API calls
- `dotenv` - Environment variable management
- `typescript` and `ts-node` - TypeScript tooling

## Installation Methods

### 1. DXT Extension (One-click Installation) - Recommended
Simplest method for end users:
- Download `obsidian-mcp.dxt` file  
- Double-click to install, configure via GUI
- No manual JSON configuration required

### 2. NPM Package (Remote Installation)  
For Node.js users who want automatic updates:
- Uses npx for zero-installation deployment
- Always fetches latest version from NPM registry
- Configured via bash wrapper in MCP client

### 3. Local Deployment
For users needing offline usage or full control:
- **Global Installation**: npm install -g for system-wide access
- **Source Deployment**: Git clone + local build for customization
- **Docker Deployment**: Containerized deployment for isolation

## Configuration Parameters

All methods require these configuration values:
- `vault_path` / `OBSIDIAN_VAULT_PATH`: Path to Obsidian vault
- `api_token` / `OBSIDIAN_API_TOKEN`: Obsidian Local REST API plugin token
- `api_port` / `OBSIDIAN_API_PORT`: API port (default: 27123)

## Key Features

### Advanced File Operations
- **Efficient Note Moving**: Uses filesystem-level operations (fs.renameSync) instead of content copying
- **Universal File Support**: Handles all file types including PDF, images, videos, and binary files
- **Large File Safe**: No upper limit on file size, avoids model context length restrictions  
- **Atomic Operations**: Ensures file integrity with atomic filesystem operations
- **Auto Directory Management**: Creates destination directories and cleans up empty source directories

### Robust Error Handling
- **Dual API Strategy**: Primary Obsidian REST API with filesystem fallback
- **Comprehensive Validation**: Checks source existence and destination conflicts
- **Graceful Degradation**: Falls back to reliable filesystem operations when API fails

## Docker Support

The project includes Docker configuration (`Dockerfile` and `docker-compose.yml`) for containerized deployment with proper environment variable handling and volume mounting for vault access.

## Debugging

For troubleshooting DXT issues, detailed debug code is available in `debug-code.md`. The debug version adds extensive logging to:
- API request/response details
- File path resolution  
- Search matching logic
- Error handling flows

To enable debug mode:
1. Copy debug code from `debug-code.md` to appropriate locations in `src/index.ts`
2. Build and generate debug DXT version
3. Monitor Claude Desktop logs: `tail -f ~/Library/Logs/Claude/mcp*.log`

## Auto Backlink Vault Tool

The `auto_backlink_vault` tool provides intelligent automation for creating backlinks across your entire Obsidian vault. It scans all notes for mentions of other note names and automatically converts them to wikilink format (`[[note name]]`).

### Key Features:
- **Smart Detection**: Identifies note names in content while avoiding false positives
- **Batch Processing**: Handles large vaults efficiently with configurable batch sizes
- **Safe Execution**: Defaults to dry-run mode for previewing changes before applying
- **Pattern Exclusion**: Skip specific folders or file patterns (e.g., templates, archives)
- **Intelligent Filtering**: Avoids linking common words and respects existing links
- **Performance Optimized**: Memory-efficient processing with progress reporting

### Usage Parameters:
- `dryRun` (default: true) - Preview changes without applying them
- `excludePatterns` (default: []) - Array of glob patterns to exclude
- `minLength` (default: 3) - Minimum note name length for linking
- `caseSensitive` (default: false) - Whether matching is case sensitive
- `wholeWords` (default: true) - Match only complete words
- `batchSize` (default: 50) - Notes processed per batch

### Safety Features:
- Skips code blocks, existing links, and URLs
- Avoids common English words to prevent over-linking
- Provides detailed preview before making changes
- Supports undo through version control integration

## Recent Updates (v1.5.0) ✨ RELEASED

### 🔗 Auto Backlink Vault - Major Feature Release

- **🔗 Auto Backlink Vault**: New tool for automated backlink creation across entire vault
- **🧠 Smart Pattern Matching**: Intelligent detection of note names with false positive prevention
- **⚡ Batch Processing**: Memory-efficient processing of large vaults
- **🛡️ Safety First**: Comprehensive dry-run mode and validation
- **🎯 Precision Linking**: Configurable matching with common word filtering
- **📊 Detailed Reporting**: Progress tracking and change previews

**Published**: v1.5.0 is now live on NPM, GitHub, and available as DXT package!
- 📦 NPM: `npm install -g @huangyihe/obsidian-mcp@1.5.0`
- 🐙 GitHub: https://github.com/newtype-01/obsidian-mcp/releases/tag/v1.5.0
- 💾 DXT: Download `obsidian-mcp.dxt` for one-click installation

### Previous Updates (v1.4.0)
- **🎉 DXT Installation Fully Fixed**: Resolved all compatibility issues with Claude Desktop
- **🔍 Enhanced Search**: Dual search (filename + content), supports all file types, smart scoring
- **🚀 Stability Improvements**: Fixed API response parsing, better error handling, streamlined debug output
- **📚 Documentation**: Updated README files to reflect stable DXT support, removed compatibility warnings
- **🔧 File Type Support**: Now supports all file types (PDF, images, documents) not just .md files
- **⚡ Performance**: Optimized search with filename matching priority and binary file support
- **🛠️ New Tools**: Restored `update_note` and added `read_multiple_notes` tools

## Memories

- to memorize