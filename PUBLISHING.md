# Publishing Guide

## 发布概览

项目支持3种分发方式：

1. **DXT 扩展包** - 一键安装，适合普通用户
2. **NPM 包** - 远程安装，适合开发者  
3. **源码** - 本地部署，适合高级用户

## 1. DXT 打包

### 构建 DXT 扩展

1. 安装 DXT 工具：
```bash
npm install -g @anthropic-ai/dxt
```

2. 确保项目已构建：
```bash
npm run build
```

3. 打包为 DXT 扩展：
```bash
dxt pack .
```

这将创建 `obsidian-mcp.dxt` 文件供用户下载。

## 2. NPM 发布

### 发布到 NPM Registry

1. 确保已登录到 NPM：
```bash
npm login
```

2. 构建项目：
```bash
npm run build
```

3. 发布到 NPM：
```bash
npm publish --access public
```

**注意**: 由于使用了 scoped package `@huangyihe/obsidian-mcp`，需要 `--access public` 参数。

## 3. 源码分发

源码通过 GitHub 仓库分发，用户可以：
- Git 克隆 + 本地构建
- Docker 部署

## 用户使用方式

### DXT 方式（推荐）
```json
{
  "mcpServers": {
    "obsidian-mcp": {
      "command": "dxt",
      "args": ["path/to/obsidian-mcp.dxt"],
      "env": {
        "vault_path": "/path/to/vault",
        "api_token": "your_token"
      }
    }
  }
}
```

### NPM 方式
```bash
npm install -g @huangyihe/obsidian-mcp
obsidian-mcp --vault-path "/path/to/vault" --api-token "your_token"
```

### 源码方式
```bash
git clone https://github.com/newtype-01/obsidian-mcp.git
cd obsidian-mcp
npm install && npm run build
npm start
```

## 版本管理

使用语义化版本控制：
- `npm version patch` - 修复版本 (1.0.0 → 1.0.1)
- `npm version minor` - 功能版本 (1.0.0 → 1.1.0)  
- `npm version major` - 重大版本 (1.0.0 → 2.0.0)