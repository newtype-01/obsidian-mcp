# Testing Notes Insight Tool (v1.7.0-beta)

## 🎯 新功能测试指南

### 安装测试版DXT
1. 使用生成的 `obsidian-mcp.dxt` 文件
2. 双击安装到Claude Desktop
3. 配置环境变量：
   - `OBSIDIAN_VAULT_PATH`: 你的Obsidian库路径
   - `OBSIDIAN_API_TOKEN`: API令牌
   - `OBSIDIAN_API_PORT`: API端口（默认27123）

### 测试Notes Insight工具

#### 基本测试
```
请使用notes_insight工具分析"RAG"这个主题，给我一些深度洞察。
```

#### 高级测试
```
使用notes_insight工具分析"机器学习"主题，设置最多3个笔记，启用摘要功能。
```

#### 参数测试
```
notes_insight工具参数：
- topic: "知识管理"
- maxNotes: 3
- maxContextLength: 30000
- enableSummary: true
```

### 预期行为

1. **搜索阶段**: 工具会自动搜索库中相关笔记
2. **选择阶段**: 按相关性排序，选择最相关的笔记
3. **处理阶段**: 对长笔记进行AI摘要请求
4. **分析阶段**: 整合TRILEMMA-PRINCIPLES框架
5. **输出阶段**: 返回结构化的分析内容

### 输出格式

工具会返回包含以下内容的完整分析框架：
- TRILEMMA-PRINCIPLES分析提示词
- 相关笔记的处理内容（可能包含摘要请求）
- 具体的分析任务指令
- 结构化的输出要求

### 故障排除

如果遇到问题：
1. 确保Obsidian本地REST API插件已启动
2. 检查API令牌是否正确
3. 验证库路径是否正确
4. 查看Claude Desktop日志

### 测试重点

- ✅ 搜索功能是否正常工作
- ✅ 笔记选择是否按相关性排序
- ✅ 长笔记是否触发摘要请求
- ✅ TRILEMMA-PRINCIPLES框架是否正确集成
- ✅ 参数配置是否生效
- ✅ 错误处理是否友好

## 版本信息
- 版本: 1.7.0-beta
- 新增功能: notes_insight工具
- 基于: TRILEMMA-PRINCIPLES分析框架
- 特性: AI驱动的内容摘要和战略分析