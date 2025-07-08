# 🚀 Obsidian MCP Server v1.6.0 - PATCH 精确插入功能

## 🎯 新功能亮点

### ✨ **PATCH 精确插入 - 革命性的内容管理**

`update_note` 工具现在支持基于 **Obsidian Local REST API** 的精确插入功能，让你能够在 Markdown 文档的精确位置插入内容！

### 🔧 **核心新特性**

#### 1. **4种精确插入位置**
- `before` - 在目标元素之前插入
- `after` - 在目标元素之后插入  
- `append` - 在章节末尾追加
- `prepend` - 在章节开始处插入

#### 2. **智能目标定位**
- **标题定位**: 支持 1-6 级标题精确匹配
- **块ID定位**: 支持 `^block-id` 格式的块引用
- **模糊匹配**: 三级匹配策略确保找到目标

#### 3. **双重API策略** 
- 优先使用 Obsidian Local REST API PATCH 端点
- 自动回退到文件系统操作
- 最佳性能与可靠性兼顾

#### 4. **完全向后兼容**
- 原有替换模式完全保留
- 自动识别操作类型
- 无需修改现有代码

## 📋 **使用示例**

### 在标题后插入任务
```json
{
  "path": "项目笔记.md",
  "edits": [
    {
      "mode": "insert",
      "heading": "任务列表", 
      "content": "- [ ] 新任务1\n- [ ] 新任务2",
      "position": "append"
    }
  ]
}
```

### 在特定级别标题前插入
```json
{
  "path": "文档.md",
  "edits": [
    {
      "mode": "insert",
      "heading": "详细说明",
      "level": 2,
      "content": "## 概述\n\n重要说明内容",
      "position": "before" 
    }
  ]
}
```

### 基于块ID插入
```json
{
  "path": "笔记.md", 
  "edits": [
    {
      "mode": "insert",
      "blockId": "summary-block",
      "content": "\n**补充**: 重要信息",
      "position": "after"
    }
  ]
}
```

### 混合操作（替换+插入）
```json
{
  "path": "报告.md",
  "edits": [
    {
      "oldText": "初稿",
      "newText": "终稿"
    },
    {
      "mode": "insert", 
      "heading": "结论",
      "content": "\n## 后续步骤\n\n具体计划...",
      "position": "append"
    }
  ]
}
```

## 🛠️ **技术改进**

### 新增核心组件
- **MarkdownElement 接口** - 结构化文档解析
- **parseMarkdown() 函数** - 智能 Markdown 解析器
- **findHeadingPosition() 函数** - 多级标题定位
- **handleInsertEdit() 函数** - 精确插入处理
- **InsertError 类** - 专业错误处理

### API 集成
- `patchNoteViaAPI()` - Obsidian API PATCH 集成
- `patchNoteViaBlockAPI()` - 块级 PATCH 操作
- 自动回退机制确保兼容性

### 验证与错误处理
- `validateEditOperation()` - 完整参数验证
- 详细错误信息和操作指导
- 支持 dry-run 预览模式

## 📊 **性能与兼容性**

- ✅ **100% 向后兼容** - 原有功能完全保留
- ⚡ **高性能解析** - 优化的 Markdown 解析算法  
- 🔄 **智能回退** - API 失败时自动使用文件系统
- 🛡️ **安全验证** - 全面的输入验证和错误恢复

## 🎮 **测试新功能**

1. **下载**: 双击 `obsidian-mcp.dxt` 安装到 Claude Desktop
2. **配置**: 设置 vault_path、api_token、api_port
3. **测试**: 使用新的插入模式编辑笔记
4. **验证**: 尝试不同的位置和目标类型

## 🔧 **兼容要求**

- **Node.js**: >= 16.0.0
- **Obsidian Local REST API 插件**: 推荐最新版本
- **Claude Desktop**: 支持 MCP 的版本

## 📚 **文档**

- 详细使用示例: `PATCH_EXAMPLES.md`  
- 项目说明: `CLAUDE.md`
- API 参考: JSON Schema 内联文档

---

**下载地址**: `obsidian-mcp.dxt` (12.5MB)

通过这个更新，Obsidian MCP Server 提供了业界领先的精确内容插入能力，让 AI 与你的知识库交互更加智能和高效！🎉