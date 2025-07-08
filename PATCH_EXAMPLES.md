# PATCH 精确插入功能使用示例

## 功能概述

`update_note` 工具现在支持两种操作模式：
- **替换模式** (replace): 原有的文本替换功能，保持向后兼容
- **插入模式** (insert): 新的精确插入功能，支持基于标题和块ID的定位

## 使用示例

### 1. 在标题后插入内容

```json
{
  "path": "项目笔记.md",
  "edits": [
    {
      "mode": "insert",
      "heading": "任务列表",
      "content": "- [ ] 完成API设计\n- [ ] 编写单元测试",
      "position": "after"
    }
  ]
}
```

### 2. 在章节末尾追加内容

```json
{
  "path": "会议记录.md",
  "edits": [
    {
      "mode": "insert",
      "heading": "行动项",
      "content": "\n**新增任务**:\n- 安排下次会议\n- 更新项目计划",
      "position": "append"
    }
  ]
}
```

### 3. 在特定级别标题前插入

```json
{
  "path": "文档.md",
  "edits": [
    {
      "mode": "insert",
      "heading": "详细说明",
      "level": 2,
      "content": "## 概述\n\n这是新增的概述部分。\n",
      "position": "before"
    }
  ]
}
```

### 4. 基于块ID插入

```json
{
  "path": "笔记.md",
  "edits": [
    {
      "mode": "insert",
      "blockId": "summary-block",
      "content": "\n**补充说明**: 这个概念很重要。",
      "position": "after"
    }
  ]
}
```

### 5. 混合操作（替换+插入）

```json
{
  "path": "报告.md",
  "edits": [
    {
      "oldText": "初稿完成",
      "newText": "终稿完成"
    },
    {
      "mode": "insert",
      "heading": "结论",
      "content": "\n## 后续步骤\n\n1. 发布报告\n2. 收集反馈",
      "position": "append"
    }
  ]
}
```

### 6. 干运行预览

```json
{
  "path": "文档.md",
  "edits": [
    {
      "mode": "insert",
      "heading": "总结",
      "content": "新的总结内容",
      "position": "prepend"
    }
  ],
  "dryRun": true
}
```

## 插入位置说明

- **before**: 在目标元素之前插入
- **after**: 在目标元素之后插入
- **prepend**: 在标题对应章节的开始处插入
- **append**: 在标题对应章节的末尾插入

## 高级特性

### 标题级别筛选
使用 `level` 参数可以精确定位特定级别的标题：

```json
{
  "heading": "总结",
  "level": 2,  // 只匹配 ## 总结
  "content": "新内容"
}
```

### 模糊匹配
标题匹配支持三种级别：
1. 精确匹配
2. 包含匹配
3. 标准化匹配（忽略特殊字符）

### 错误处理
系统提供详细的错误信息：
- 标题未找到
- 块ID不存在
- 无效的插入位置
- 参数验证错误

### API 集成
- 优先使用 Obsidian Local REST API 的 PATCH 端点
- 自动回退到文件系统操作
- 支持所有 Obsidian API 功能

## 向后兼容性

原有的替换模式完全兼容：

```json
{
  "path": "文档.md",
  "edits": [
    {
      "oldText": "旧内容",
      "newText": "新内容"
    }
  ]
}
```

系统会自动识别操作类型，无需修改现有代码。