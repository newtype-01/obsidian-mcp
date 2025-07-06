# Obsidian MCP (Model Context Protocol) 服务器

[English](./README.md) | 中文

这个项目实现了一个 Model Context Protocol (MCP) 服务器，用于连接 AI 模型与 Obsidian 知识库。通过这个服务器，AI 模型可以直接访问和操作 Obsidian 笔记，包括读取、创建、更新和删除笔记，以及管理文件夹结构。

Created by huangyihe
- Prompt House: https://prompthouse.app/
- YouTube: https://www.youtube.com/@huanyihe777
- Twitter: https://x.com/huangyihe
- Community: https://t.zsxq.com/19IaNz5wK

## 功能特点

- 与 Obsidian 知识库的无缝集成
- 支持笔记的读取、创建、更新和删除
- 支持文件夹的创建、重命名、移动和删除
- 支持全文搜索功能
- 符合 Model Context Protocol 规范

## 支持的工具

MCP 服务器提供以下工具：

- `list_notes`: 列出知识库中的所有笔记
- `read_note`: 读取指定笔记的内容
- `read_multiple_notes`: 同时读取多个笔记的内容
- `create_note`: 创建新笔记
- `update_note`: 使用精确文本替换更新现有笔记内容
- `search_vault`: 在知识库中搜索内容
- `delete_note`: 删除笔记
- `move_note`: 移动或重命名笔记到新位置
- `manage_folder`: 管理文件夹 (创建、重命名、移动、删除)
- `auto_backlink_vault`: 🔗 **自动反向链接** - 扫描整个知识库，智能检测笔记名称并自动转换为 wikilink 格式 (`[[笔记名]]`)

## 前提条件

- Node.js (v16 或更高版本)
- Obsidian 桌面应用
- Obsidian Local REST API 插件 (需要在 Obsidian 中安装)

## 安装方式选择

根据您的技术水平和使用需求，选择最适合的安装方式：

| 方式 | 适合人群 | 优点 | 缺点 |
|------|---------|------|------|
| **🎯 一键安装 (DXT)** | 普通用户 | 最简单，图形界面配置 | 需要支持 DXT 的客户端 |
| **📦 远程安装 (NPM)** | Node.js 用户 | 自动更新，无需安装 | 需要网络连接 |
| **🔧 本地部署** | 高级用户 | 离线使用，完全控制 | 需要手动更新 |

---

## 方式一：一键安装 (DXT 扩展包) - ✅ 推荐

**适合：** 普通用户，想要最简单的安装体验

### 步骤 1: 下载 DXT 文件

下载预构建的扩展包：[obsidian-mcp.dxt](./obsidian-mcp.dxt)

### 步骤 2: 安装并配置

双击下载的 `.dxt` 文件，系统会自动安装扩展。然后在配置界面填入：

- **Vault Path**: 你的 Obsidian 知识库路径 (如: `/Users/username/Documents/MyVault`)
- **API Token**: Obsidian Local REST API 插件的令牌
- **API Port**: API 端口号 (默认: `27123`)

---

## 方式二：远程安装 (NPM 包)

**适合：** 熟悉 Node.js 的开发者，想要自动更新和版本管理

直接在 MCP 客户端配置文件中添加以下配置即可：

**使用 npx (推荐，无需预先安装)：**
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

> **说明**: 第一次运行时会自动下载包，后续运行会使用缓存，确保总是使用最新版本。

---

## 方式三：本地部署

**适合：** 需要自定义、高级控制或离线使用的用户

### 选项 A: 全局安装 (推荐)

**步骤 1: 全局安装**
```bash
npm install -g @huangyihe/obsidian-mcp
```

**步骤 2: MCP 客户端配置**
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

### 选项 B: 源码部署

**步骤 1: 克隆仓库**
```bash
git clone https://github.com/newtype-01/obsidian-mcp.git
cd obsidian-mcp
```

**步骤 2: 安装依赖**
```bash
npm install
```

**步骤 3: 构建项目**
```bash
npm run build
```

**步骤 4: 配置环境变量**
```bash
cp .env.example .env
# 编辑 .env 文件，填入您的配置
```

**步骤 5: 启动服务器**
```bash
npm start
```

### 选项 C: Docker 部署

**使用 Docker Compose (推荐)**

```bash
# 配置环境变量
cp .env.example .env
# 编辑 .env 文件

# 启动服务
docker-compose up -d
```

**使用 Docker 命令**

```bash
# 构建镜像
docker build -t obsidian-mcp .

# 运行容器
docker run -d \
  --name obsidian-mcp \
  --env-file .env \
  --network host \
  -v $(OBSIDIAN_VAULT_PATH):$(OBSIDIAN_VAULT_PATH) \
  obsidian-mcp
```

---

## 配置说明

### 环境变量

所有安装方式都需要以下配置：

- `OBSIDIAN_VAULT_PATH`: Obsidian 知识库的路径
- `OBSIDIAN_API_TOKEN`: Obsidian Local REST API 插件的 API 令牌
- `OBSIDIAN_API_PORT`: Obsidian Local REST API 插件的端口号 (默认为 27123)

⚠️ **重要提示**: 对于远程 NPM 安装和全局安装，必须使用 `OBSIDIAN_` 前缀的环境变量。不带前缀的变量如 `VAULT_PATH`、`API_TOKEN` 将无法正常工作。

### 获取 API Token

1. 在 Obsidian 中安装 "Local REST API" 插件
2. 在插件设置中生成 API Token
3. 记录端口号（默认 27123）

---

## 测试

项目包含一个测试脚本，用于验证服务器功能：

```bash
node test-mcp.js
```

## 开发

- 使用 `npm run dev` 在开发模式下运行服务器
- 源代码位于 `src` 目录中

## 许可证

MIT

## 贡献

欢迎提交 Pull Requests 和 Issues！

## 相关项目

- [Model Context Protocol](https://github.com/anthropics/model-context-protocol)
- [Obsidian Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api)