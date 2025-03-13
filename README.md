# Obsidian MCP (Model Context Protocol) 服务器

[English](./README.en.md) | 中文

这个项目实现了一个 Model Context Protocol (MCP) 服务器，用于连接 AI 模型与 Obsidian 知识库。通过这个服务器，AI 模型可以直接访问和操作 Obsidian 笔记，包括读取、创建、更新和删除笔记，以及管理文件夹结构。

## 功能特点

- 与 Obsidian 知识库的无缝集成
- 支持笔记的读取、创建、更新和删除
- 支持文件夹的创建、重命名、移动和删除
- 支持全文搜索功能
- 符合 Model Context Protocol 规范

## 前提条件

- Node.js (v16 或更高版本)
- Obsidian 桌面应用
- Obsidian Local REST API 插件 (需要在 Obsidian 中安装)

## 安装

1. 克隆此仓库：

```bash
git clone https://github.com/newtype-01/obsidian-mcp.git
cd obsidian-mcp
```

2. 安装依赖：

```bash
npm install
```

3. 构建项目：

```bash
npm run build
```

## 配置

服务器通过环境变量进行配置：

- `OBSIDIAN_VAULT_PATH`: Obsidian 知识库的路径
- `OBSIDIAN_API_TOKEN`: Obsidian Local REST API 插件的 API 令牌
- `OBSIDIAN_API_PORT`: Obsidian Local REST API 插件的端口号 (默认为 27123)

您可以通过以下方式设置环境变量：

1. 复制 `.env.example` 文件为 `.env` 并编辑其中的值：

```bash
cp .env.example .env
```

2. 编辑 `.env` 文件，填入您的实际配置：

```
OBSIDIAN_VAULT_PATH=/path/to/your/vault
OBSIDIAN_API_TOKEN=your_api_token_here
OBSIDIAN_API_PORT=27123
```

**注意：** `.env` 文件包含敏感信息，已被添加到 `.gitignore` 中，不会被提交到版本控制系统。

## 使用方法

1. 确保 Obsidian 正在运行，并且已安装和配置了 Local REST API 插件

2. 启动 MCP 服务器：

```bash
npm start
```

3. 服务器将通过标准输入/输出与 AI 模型通信

## 测试

项目包含一个测试脚本，用于验证服务器功能：

```bash
node test-mcp.js
```

## 支持的工具

MCP 服务器提供以下工具：

- `list_notes`: 列出知识库中的所有笔记
- `read_note`: 读取指定笔记的内容
- `create_note`: 创建新笔记
- `update_note`: 更新现有笔记
- `search_vault`: 在知识库中搜索内容
- `delete_note`: 删除笔记
- `manage_folder`: 管理文件夹 (创建、重命名、移动、删除)

## 开发

- 使用 `npm run dev` 在开发模式下运行服务器
- 源代码位于 `src` 目录中

## 许可证

ISC

## 贡献

欢迎提交 Pull Requests 和 Issues！

## 相关项目

- [Model Context Protocol](https://github.com/anthropics/model-context-protocol)
- [Obsidian Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api) 