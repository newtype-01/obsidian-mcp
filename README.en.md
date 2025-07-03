# Obsidian MCP (Model Context Protocol) Server

English | [中文](./README.md)

This project implements a Model Context Protocol (MCP) server for connecting AI models with Obsidian knowledge bases. Through this server, AI models can directly access and manipulate Obsidian notes, including reading, creating, updating, and deleting notes, as well as managing folder structures.

## Features

- Seamless integration with Obsidian knowledge bases
- Support for reading, creating, updating, and deleting notes
- Support for creating, renaming, moving, and deleting folders
- Full-text search functionality
- Compliance with the Model Context Protocol specification

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

## Method 1: One-Click Install (DXT Package) - Recommended

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
      "command": "bash",
      "args": [
        "-c",
        "npx @huangyihe/obsidian-mcp --vault-path \"$VAULT_PATH\" --api-token \"$API_TOKEN\""
      ],
      "env": {
        "VAULT_PATH": "/path/to/your/vault",
        "API_TOKEN": "your_api_token"
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
      "args": [
        "--vault-path",
        "/path/to/your/vault",
        "--api-token",
        "your_api_token"
      ]
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

- `OBSIDIAN_VAULT_PATH` / `vault_path`: Path to your Obsidian vault
- `OBSIDIAN_API_TOKEN` / `api_token`: API token for Obsidian Local REST API plugin
- `OBSIDIAN_API_PORT` / `api_port`: API port for Obsidian Local REST API (default: 27123)

### Getting API Token

1. Install "Local REST API" plugin in Obsidian
2. Generate API Token in plugin settings
3. Note the port number (default 27123)


## Testing

The project includes a test script to verify server functionality:

```bash
node test-mcp.js
```

## Supported Tools

The MCP server provides the following tools:

- `list_notes`: List all notes in the Obsidian vault
- `read_note`: Read the content of a note in the Obsidian vault
- `create_note`: Create a new note in the Obsidian vault
- `update_note`: Update an existing note in the Obsidian vault
- `search_vault`: Search for content in the Obsidian vault
- `delete_note`: Delete a note from the Obsidian vault
- `move_note`: Move or rename a note to a new location in the Obsidian vault
- `manage_folder`: Create, rename, move, or delete a folder in the Obsidian vault

## Development

- Use `npm run dev` to run the server in development mode
- Source code is located in the `src` directory

## License

ISC

## Contributing

Pull Requests and Issues are welcome!

## Related Projects

- [Model Context Protocol](https://github.com/anthropics/model-context-protocol)
- [Obsidian Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api) 