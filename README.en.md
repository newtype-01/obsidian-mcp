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

## Installation

1. Clone this repository:

```bash
git clone https://github.com/newtype-01/obsidian-mcp.git
cd obsidian-mcp
```

2. Install dependencies:

```bash
npm install
```

3. Build the project:

```bash
npm run build
```

## Configuration

The server is configured through environment variables:

- `OBSIDIAN_VAULT_PATH`: Path to the Obsidian vault
- `OBSIDIAN_API_TOKEN`: API token for the Obsidian Local REST API plugin
- `OBSIDIAN_API_PORT`: Port number for the Obsidian Local REST API plugin (default is 27123)

You can set environment variables using the following method:

1. Copy the `.env.example` file to `.env` and edit the values:

```bash
cp .env.example .env
```

2. Edit the `.env` file and fill in your actual configuration:

```
OBSIDIAN_VAULT_PATH=/path/to/your/vault
OBSIDIAN_API_TOKEN=your_api_token_here
OBSIDIAN_API_PORT=27123
```

**Note:** The `.env` file contains sensitive information and has been added to `.gitignore` to prevent it from being committed to version control.

## Usage

1. Make sure Obsidian is running and the Local REST API plugin is installed and configured

2. Start the MCP server:

```bash
npm start
```

3. The server will communicate with AI models through standard input/output

## Testing

The project includes a test script to verify server functionality:

```bash
npm test
```

## Supported Tools

The MCP server provides the following tools:

- `list_notes`: List all notes in the knowledge base
- `read_note`: Read the content of a specified note
- `create_note`: Create a new note
- `update_note`: Update an existing note
- `search_vault`: Search for content in the knowledge base
- `delete_note`: Delete a note
- `manage_folder`: Manage folders (create, rename, move, delete)

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