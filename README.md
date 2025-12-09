# Obsidian MCP (Model Context Protocol) Server

English | [中文](./README.zh.md)

This project implements a Model Context Protocol (MCP) server for connecting AI models with Obsidian knowledge bases. Through this server, AI models can directly access and manipulate Obsidian notes, including reading, creating, updating, and deleting notes, as well as managing folder structures.

## What's New in v2.0.0-beta 🎉

This version adds **30 new tools** across 6 major categories:

- **🏷️ Tag Management (5 tools)**: List, add, remove, find by tags, and rename tags across vault
- **🔗 Graph & Link Analysis (5 tools)**: Backlinks, outgoing links, orphaned notes, broken links, and link graph visualization
- **📋 Metadata & Frontmatter (3 tools)**: Update, get, and bulk-update frontmatter properties
- **📅 Daily Notes & Templates (3 tools)**: Create daily notes, get specific dates, and apply templates with variables
- **📊 Analytics & Statistics (3 tools)**: Note stats, vault stats, and recent notes tracking
- **✂️ Content Operations (4 tools)**: Merge notes, split by headings, duplicate, and append with timestamps
- **📎 Attachment Management (3 tools)**: List attachments, find unused files, and get note attachments
- **⚙️ Configuration Management (7 tools)**: Smart defaults and custom note patterns for projects, books, meetings, etc.

**Total: 45 tools** (15 original + 30 new)

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

The MCP server provides **45 comprehensive tools** organized into categories:

### 📋 Core Operations
- `list_notes`: List notes in the Obsidian vault with optional folder filtering
  - **NEW** `recursive` parameter: Control whether to list files recursively in subdirectories (default: true)
  - Use `recursive: false` to list only files in the specified folder without subdirectories
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

### 🏷️ Tag Management
- `list_tags`: List all tags with occurrence counts (sortable by name or count)
- `add_tags`: Add tags to notes (frontmatter/inline/both locations)
- `remove_tags`: Remove tags from notes
- `find_notes_by_tag`: Find notes by tags with AND/OR logic
- `rename_tag`: Rename tags across entire vault with dry-run preview

### 🔗 Graph & Link Analysis
- `get_backlinks`: Find all notes linking to a specific note
- `get_outgoing_links`: List all outgoing links from a note
- `find_orphaned_notes`: Find notes with no incoming or outgoing links
- `find_broken_links`: Detect broken wikilinks in the vault
- `get_link_graph`: Generate graph data (nodes/edges) for visualization

### 📋 Metadata & Frontmatter
- `update_frontmatter`: Add, update, or delete frontmatter properties
- `get_frontmatter`: Extract frontmatter from a note
- `bulk_update_metadata`: Update frontmatter across multiple notes

### 📅 Daily Notes & Templates
- `create_daily_note`: Create or get today's daily note (uses config defaults)
- `get_daily_note`: Get daily note for specific date
- `apply_template`: Apply template with variable replacement ({{title}}, {{date}}, etc.)

### 📊 Analytics & Statistics
- `get_note_stats`: Word count, character count, reading time, link count, tag count, headings
- `get_vault_stats`: Total notes, attachments, words, links, unique tags, vault size
- `get_recent_notes`: List recently modified or created notes

### ✂️ Content Operations
- `merge_notes`: Combine multiple notes into one with custom separator
- `split_note`: Split note by headings into separate files
- `duplicate_note`: Create a copy of a note
- `append_to_note`: Quick append with optional timestamp

### 📎 Attachment Management
- `list_attachments`: List all media/PDF files with size info (filterable by type)
- `find_unused_attachments`: Find orphaned attachments not referenced anywhere
- `get_note_attachments`: List attachments referenced in a specific note

### ⚙️ Configuration Management
- `get_config`: View current configuration
- `update_config`: Update config values (e.g., daily notes folder, tag location)
- `add_pattern`: Add custom note patterns (projects, books, meetings, etc.)
- `remove_pattern`: Remove a custom pattern
- `list_patterns`: List all configured patterns
- `create_pattern_note`: Create notes using saved patterns
- `reset_config`: Reset configuration to defaults

**Configuration enables:**
- Set default folders for daily notes, templates, attachments
- Define custom note patterns (e.g., project notes in "Projects" folder)
- Never repeat folder paths - configure once, use everywhere
- Supports template variables: {{title}}, {{date}}, {{time}}, and custom variables

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
        "@augustovq/mine-obsidian-mcp"
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
npm install -g @augustovq/mine-obsidian-mcp
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