# Obsidian MCP (Model Context Protocol) 服务器

[English](./README.md) | 中文

这个项目实现了一个 Model Context Protocol (MCP) 服务器，用于连接 AI 模型与 Obsidian 知识库。通过这个服务器，AI 模型可以直接访问和操作 Obsidian 笔记，包括读取、创建、更新和删除笔记，以及管理文件夹结构。

Created by huangyihe
- Prompt House: https://prompthouse.app/
- YouTube: https://www.youtube.com/@huanyihe777
- Twitter: https://x.com/huangyihe
- Community: https://t.zsxq.com/19IaNz5wK

## 功能特点

- **🔗 无缝 Obsidian 集成**: 通过 MCP 协议直接访问 Obsidian 知识库
- **📝 完整笔记管理**: 读取、创建、更新和删除笔记，支持高级文本替换
- **📁 文件夹操作**: 创建、重命名、移动和删除文件夹，支持完整层级结构
- **🔍 智能搜索**: 跨所有文件类型的全文搜索，具备智能评分机制
- **🤖 AI 驱动分析**: **全新** 使用 TRILEMMA-PRINCIPLES 框架进行战略洞察分析
- **🔗 自动反向链接**: **全新** 智能检测笔记名称并转换为 wikilink 格式
- **⚡ 精确编辑**: 高级 PATCH 操作，支持标题和块级定位
- **🚀 双重 API 策略**: Obsidian REST API 结合文件系统回退，确保最大可靠性
- **🎯 上下文优化**: 智能内容摘要，优化 LLM 上下文长度管理
- **📊 批处理**: 高效的批量操作，带有进度追踪

## 支持的工具

MCP 服务器提供以下全面的工具集：

### 📋 核心操作
- `list_notes`: 列出知识库中的所有笔记，支持文件夹过滤
- `read_note`: 读取知识库中特定笔记的内容
- `read_multiple_notes`: 同时读取多个笔记的内容，支持批处理
- `create_note`: 在知识库中创建包含完整内容的新笔记
- `delete_note`: 从知识库中删除笔记
- `search_vault`: 跨所有文件类型的高级搜索，支持文件名和内容匹配
- `move_note`: 移动或重命名笔记到新位置 (支持所有文件类型包括PDF)
- `manage_folder`: 完整的文件夹 CRUD 操作 (创建/重命名/移动/删除)

### 🚀 高级功能
- `update_note`: **增强版** 支持文本替换或精确插入的内容更新
  - 传统文本替换模式
  - **全新** 基于标题的插入 (before/after/append/prepend)
  - **全新** 基于块ID的插入，支持 `^block-id` 格式
  - **全新** PATCH API 集成，带文件系统回退

- `auto_backlink_vault`: **🔗 自动反向链接生成**
  - 智能扫描整个知识库中的笔记名称提及
  - 将文本引用转换为 wikilink 格式 (`[[笔记名]]`)
  - 智能模式匹配，防止误识别
  - 可配置的预览模式和批处理
  
- `notes_insight`: **🧠 AI 驱动的战略分析** ⭐ **全新功能**
  - 使用 TRILEMMA-PRINCIPLES 框架生成战略洞察
  - 自动基于主题的笔记发现和相关性排序
  - AI 驱动的内容摘要，优化上下文长度
  - 结构化分析：约束识别 → 假设挑战 → 突破性解决方案
  - 可配置的分析深度和范围参数

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