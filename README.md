# Obsidian MCP (Model Context Protocol) Server

English | [中文](./README.zh.md)

This project implements a Model Context Protocol (MCP) server for connecting AI models with Obsidian knowledge bases. Through this server, AI models can directly access and manipulate Obsidian notes, including reading, creating, updating, and deleting notes, as well as managing folder structures.

Created by huangyihe
- Prompt House: https://prompthouse.app/
- YouTube: https://www.youtube.com/@huanyihe777
- Twitter: https://x.com/huangyihe
- Community: https://t.zsxq.com/19IaNz5wK

## Features

- **🔗 Seamless Obsidian Integration**: Direct access to Obsidian knowledge bases through MCP protocol
- **📝 Complete Note Management**: Read, create, update, and delete notes with advanced text replacement
- **📁 Folder Operations**: Create, rename, move, and delete folders with full hierarchy support
- **🔍 Intelligent Search**: Full-text search across all file types with smart scoring
- **🤖 AI-Powered Analysis**: **NEW** Strategic insights using TRILEMMA-PRINCIPLES framework
- **🔗 Auto Backlink Generation**: **NEW** Intelligent detection and conversion of note names to wikilinks
- **⚡ Precision Editing**: Advanced PATCH operations with heading and block-level targeting
- **🚀 Dual API Strategy**: Obsidian REST API with filesystem fallback for maximum reliability
- **🎯 Context Optimization**: Smart content summarization for LLM context length management
- **📊 Batch Processing**: Efficient bulk operations with progress tracking

## Supported Tools

The MCP server provides the following comprehensive tools:

### 📋 Core Operations
- `list_notes`: List all notes in the Obsidian vault with optional folder filtering
- `read_note`: Read the content of a specific note in the Obsidian vault
- `read_multiple_notes`: Read content from multiple notes simultaneously for batch processing
- `create_note`: Create a new note in the Obsidian vault with full content
- `delete_note`: Delete a note from the Obsidian vault
- `search_vault`: Advanced search across all file types with filename and content matching
- `move_note`: Move or rename notes to new locations (supports all file types including PDFs)
- `manage_folder`: Complete folder CRUD operations (create/rename/move/delete)

### 🚀 Advanced Features
- `update_note`: **Enhanced** Update content using text replacements OR precision insertion
  - Traditional text replacement mode
  - **NEW** Heading-based insertion (before/after/append/prepend)
  - **NEW** Block ID-based insertion with `^block-id` support
  - **NEW** PATCH API integration with filesystem fallback

- `auto_backlink_vault`: **🔗 Auto Backlink Generation**
  - Intelligently scan entire vault for note name mentions
  - Convert text references to wikilink format (`[[note name]]`)
  - Smart pattern matching with false positive prevention
  - Configurable dry-run mode and batch processing
  
- `notes_insight`: **🧠 AI-Powered Strategic Analysis** ⭐ **NEW**
  - Generate strategic insights using TRILEMMA-PRINCIPLES framework
  - Automatic topic-based note discovery and relevance ranking
  - AI-driven content summarization for context optimization
  - Structured analysis: constraint identification → assumption challenges → breakthrough solutions
  - Configurable parameters for analysis depth and scope

## Prerequisites

- Node.js (v16 or higher)
- Obsidian desktop application
- Obsidian Local REST API plugin (needs to be installed in Obsidian)

## Installation Options

Choose the most suitable installation method based on your technical level and usage needs:

| Method | Target Users | Advantages | Disadvantages |
|--------|-------------|------------|---------------|
| **🎯 One-Click Install (DXT)** | General users | Simplest, GUI configuration | Requires DXT-enabled client |
| **📦 Remote Install (NPM)** | Node.js users | Auto-updates, no installation | Requires network connection |
| **🔧 Local Deploy** | Advanced users | Offline use, full control | Manual updates required |

---

## Method 1: One-Click Install (DXT Package) - ✅ Recommended

**Suitable for:** General users who want the simplest installation experience

### Step 1: Download DXT File

Download the pre-built extension package: [obsidian-mcp.dxt](./obsidian-mcp.dxt)

### Step 2: Install and Configure

Double-click the downloaded `.dxt` file and the system will automatically install the extension. Then fill in the configuration interface:

- **Vault Path**: Your Obsidian vault path (e.g., `/Users/username/Documents/MyVault`)
- **API Token**: Obsidian Local REST API plugin token
- **API Port**: API port number (default: `27123`)

---

## Method 2: Remote Install (NPM Package)

**Suitable for:** Node.js developers who want automatic updates and version management

Simply add the following configuration to your MCP client config file:

**Using npx (recommended, no pre-installation required):**
```json
{
  "mcpServers": {
    "obsidian-mcp": {
      "command": "npx",
      "args": [
        "@huangyihe/obsidian-mcp"
      ],
      "env": {
        "OBSIDIAN_VAULT_PATH": "/path/to/your/vault",
        "OBSIDIAN_API_TOKEN": "your_api_token",
        "OBSIDIAN_API_PORT": "27123"
      }
    }
  }
}
```

> **Note**: First run will automatically download the package, subsequent runs use cache, ensuring you always use the latest version.

---

## Method 3: Local Deploy

**Suitable for:** Users who need customization, advanced control, or offline usage

### Option A: Global Install (Recommended)

**Step 1: Global Install**
```bash
npm install -g @huangyihe/obsidian-mcp
```

**Step 2: MCP Client Configuration**
```json
{
  "mcpServers": {
    "obsidian-mcp": {
      "command": "obsidian-mcp",
      "env": {
        "OBSIDIAN_VAULT_PATH": "/path/to/your/vault",
        "OBSIDIAN_API_TOKEN": "your_api_token",
        "OBSIDIAN_API_PORT": "27123"
      }
    }
  }
}
```

### Option B: Source Deploy

**Step 1: Clone Repository**
```bash
git clone https://github.com/newtype-01/obsidian-mcp.git
cd obsidian-mcp
```

**Step 2: Install Dependencies**
```bash
npm install
```

**Step 3: Build Project**
```bash
npm run build
```

**Step 4: Configure Environment Variables**
```bash
cp .env.example .env
# Edit .env file with your configuration
```

**Step 5: Start Server**
```bash
npm start
```

### Option C: Docker Deploy

**Using Docker Compose (Recommended)**

```bash
# Configure environment variables
cp .env.example .env
# Edit .env file

# Start service
docker-compose up -d
```

**Using Docker Command**

```bash
# Build image
docker build -t obsidian-mcp .

# Run container
docker run -d \
  --name obsidian-mcp \
  --env-file .env \
  --network host \
  -v $(OBSIDIAN_VAULT_PATH):$(OBSIDIAN_VAULT_PATH) \
  obsidian-mcp
```

---

## Configuration Guide

### Environment Variables

All installation methods require the following configuration:

- `OBSIDIAN_VAULT_PATH`: Path to your Obsidian vault
- `OBSIDIAN_API_TOKEN`: API token for Obsidian Local REST API plugin  
- `OBSIDIAN_API_PORT`: API port for Obsidian Local REST API (default: 27123)

⚠️ **Important**: For remote NPM installation and global installation, you MUST use the `OBSIDIAN_` prefix for environment variables. The variables `VAULT_PATH`, `API_TOKEN` without the prefix will not work correctly.

### Getting API Token

1. Install "Local REST API" plugin in Obsidian
2. Generate API Token in plugin settings
3. Note the port number (default 27123)


## Testing

The project includes a test script to verify server functionality:

```bash
node test-mcp.js
```

## Development

- Use `npm run dev` to run the server in development mode
- Source code is located in the `src` directory

## License

MIT

## Contributing

Pull Requests and Issues are welcome!

## Related Projects

- [Model Context Protocol](https://github.com/anthropics/model-context-protocol)
- [Obsidian Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api) 