# 调试代码备份

这个文件包含了用于排查DXT问题的调试代码，以备将来需要时使用。

## FORCE DEBUG 启动代码

在 `src/index.ts` 的第235行左右（CONFIG解析后）添加：

```typescript
// Force debug output to stdout (visible in logs)
console.log(`[FORCE-DEBUG] Command line args: ${JSON.stringify(process.argv)}`);
console.log(`[FORCE-DEBUG] Current working directory: ${process.cwd()}`);
console.log(`[FORCE-DEBUG] Environment variables:`);
console.log(`[FORCE-DEBUG] - OBSIDIAN_VAULT_PATH: ${process.env.OBSIDIAN_VAULT_PATH || 'NOT SET'}`);
console.log(`[FORCE-DEBUG] - OBSIDIAN_API_TOKEN: ${process.env.OBSIDIAN_API_TOKEN ? 'SET' : 'NOT SET'}`);
console.log(`[FORCE-DEBUG] - OBSIDIAN_TRANSPORT: ${process.env.OBSIDIAN_TRANSPORT || 'NOT SET'}`);
console.log(`[FORCE-DEBUG] Parsed configuration:`);
console.log(`[FORCE-DEBUG] - Vault Path (original): ${CONFIG.vaultPath}`);
console.log(`[FORCE-DEBUG] - Vault Path (resolved): ${VAULT_PATH}`);
console.log(`[FORCE-DEBUG] - API Base URL: ${API_BASE_URL}`);
console.log(`[FORCE-DEBUG] - API Token: ${API_TOKEN ? API_TOKEN.substring(0, 8) + '...' : 'NOT SET'}`);
console.log(`[FORCE-DEBUG] - Transport Mode: ${TRANSPORT_MODE}`);
console.log(`[FORCE-DEBUG] - HTTP Server: ${HTTP_HOST}:${HTTP_PORT}`);

// Also output to stderr
console.error(`[FORCE-DEBUG] Command line args: ${JSON.stringify(process.argv)}`);
console.error(`[FORCE-DEBUG] Current working directory: ${process.cwd()}`);
console.error(`[FORCE-DEBUG] Environment variables:`);
console.error(`[FORCE-DEBUG] - OBSIDIAN_VAULT_PATH: ${process.env.OBSIDIAN_VAULT_PATH || 'NOT SET'}`);
console.error(`[FORCE-DEBUG] - OBSIDIAN_API_TOKEN: ${process.env.OBSIDIAN_API_TOKEN ? 'SET' : 'NOT SET'}`);
console.error(`[FORCE-DEBUG] - OBSIDIAN_TRANSPORT: ${process.env.OBSIDIAN_TRANSPORT || 'NOT SET'}`);
console.error(`[FORCE-DEBUG] Parsed configuration:`);
console.error(`[FORCE-DEBUG] - Vault Path (original): ${CONFIG.vaultPath}`);
console.error(`[FORCE-DEBUG] - Vault Path (resolved): ${VAULT_PATH}`);
console.error(`[FORCE-DEBUG] - API Base URL: ${API_BASE_URL}`);
console.error(`[FORCE-DEBUG] - API Token: ${API_TOKEN ? API_TOKEN.substring(0, 8) + '...' : 'NOT SET'}`);
console.error(`[FORCE-DEBUG] - Transport Mode: ${TRANSPORT_MODE}`);
console.error(`[FORCE-DEBUG] - HTTP Server: ${HTTP_HOST}:${HTTP_PORT}`);
```

## readNote 方法详细调试

替换 `readNote` 方法中的简单实现为详细调试版本：

```typescript
private async readNote(notePath: string): Promise<string> {
  console.log(`[DEBUG] Reading note: ${notePath}`);
  console.log(`[DEBUG] VAULT_PATH: ${VAULT_PATH}`);
  
  try {
    // First try using the Obsidian API
    const apiUrl = `/vault/${encodeURIComponent(notePath)}`;
    console.log(`[DEBUG] API URL: ${apiUrl}`);
    const response = await this.api.get(apiUrl);
    console.log(`[DEBUG] API Response status: ${response.status}`);
    console.log(`[DEBUG] API Response data:`, response.data);
    // API returns the content directly, not wrapped in {content: ...}
    const content = response.data || '';
    console.log(`[DEBUG] API content length: ${content.length}`);
    return content;
  } catch (error) {
    console.warn('API request failed, falling back to file system:', error);
    
    // Fallback to file system if API fails
    const fullPath = path.join(VAULT_PATH, notePath);
    console.log(`[DEBUG] Fallback file path: ${fullPath}`);
    console.log(`[DEBUG] File exists: ${fs.existsSync(fullPath)}`);
    
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf-8');
      console.log(`[DEBUG] File content length: ${content.length}`);
      return content;
    } else {
      console.log(`[DEBUG] File not found: ${fullPath}`);
      return '';
    }
  }
}
```

## searchVault 方法详细调试

替换 `searchVault` 方法中的简单实现为详细调试版本：

```typescript
private async searchVault(query: string): Promise<any[]> {
  console.log(`[DEBUG] Searching vault for: ${query}`);
  
  try {
    // First try using the Obsidian API
    const apiUrl = `/search?query=${encodeURIComponent(query)}`;
    console.log(`[DEBUG] Search API URL: ${apiUrl}`);
    const response = await this.api.get(apiUrl);
    console.log(`[DEBUG] Search API Response status: ${response.status}`);
    console.log(`[DEBUG] Search API Response data:`, response.data);
    // Check if API returns results directly or wrapped in {results: ...}
    const results = response.data.results || response.data || [];
    console.log(`[DEBUG] Search API results length: ${results.length}`);
    return results;
  } catch (error) {
    console.warn('API request failed, falling back to simple search:', error);
    
    // Fallback to simple search if API fails
    const files = await this.listVaultFiles();
    console.log(`[DEBUG] Fallback search - files found: ${files.length}`);
    const results = [];
    
    for (const file of files) {
      try {
        const lowerQuery = query.toLowerCase();
        const lowerFileName = file.toLowerCase();
        let matchedByName = false;
        let matchedByContent = false;
        
        // Check if filename contains the query
        if (lowerFileName.includes(lowerQuery)) {
          matchedByName = true;
        }
        
        // Check if content contains the query (only for text files)
        let content = '';
        try {
          content = await this.readNote(file);
          if (typeof content === 'string' && content.toLowerCase().includes(lowerQuery)) {
            matchedByContent = true;
          }
        } catch (readError) {
          console.log(`[DEBUG] Could not read file ${file} for content search:`, readError);
          // For binary files that can't be read as text, only use filename matching
        }
        
        // Add to results if matched by name or content
        if (matchedByName || matchedByContent) {
          const matchType = matchedByName ? 'filename' : 'content';
          const lineMatch = matchedByContent && typeof content === 'string' 
            ? content.split('\n').findIndex(line => line.toLowerCase().includes(lowerQuery))
            : -1;
            
          results.push({
            path: file,
            score: matchedByName ? 2 : 1, // Higher score for filename matches
            matches: [{ 
              line: lineMatch,
              type: matchType 
            }],
          });
          
          console.log(`[DEBUG] Found match in ${file} by ${matchType}`);
        }
      } catch (error) {
        console.log(`[DEBUG] Skipping file ${file} due to error:`, error);
      }
    }
    
    return results;
  }
}
```

## 使用方法

1. 需要调试时，将对应的调试代码复制到 `src/index.ts` 的相应位置
2. 运行 `npm run build` 重新构建
3. 运行 `node generate-dxt.js` 生成调试版DXT
4. 安装调试版DXT并查看Claude Desktop日志：`tail -f ~/Library/Logs/Claude/mcp*.log`
5. 完成调试后，恢复到正式版本的代码

## 版本历史

- v1.3.2: 首次添加FORCE DEBUG输出到stdout和stderr
- v1.3.3: 添加readNote方法详细调试
- v1.3.4: 修复API响应数据结构问题
- v1.3.5: 修复搜索功能的文件类型处理
- v1.3.6: 完善搜索逻辑，支持文件名和内容双重搜索
- v1.4.0: 移除调试代码，发布稳定版本