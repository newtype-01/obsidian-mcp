#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import axios, { AxiosInstance } from 'axios';
import * as path from 'path';
import * as fs from 'fs';
import { createHash } from 'crypto';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { URL } from 'url';
import { createTwoFilesPatch } from 'diff';
import YAML from 'yaml';

// Parse command line arguments for NPM usage
function parseCliArgs() {
  const args = process.argv.slice(2);
  
  // First try environment variables, then CLI args as fallback
  const config = {
    vaultPath: process.env.OBSIDIAN_VAULT_PATH || './vault',
    apiToken: process.env.OBSIDIAN_API_TOKEN || '',
    apiPort: process.env.OBSIDIAN_API_PORT || '27123',
    apiHost: process.env.OBSIDIAN_API_HOST || '127.0.0.1',
    transport: process.env.OBSIDIAN_TRANSPORT || 'stdio',
    httpPort: process.env.OBSIDIAN_HTTP_PORT || '3000',
    httpHost: process.env.OBSIDIAN_HTTP_HOST || '127.0.0.1',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--vault-path' && i + 1 < args.length) {
      config.vaultPath = args[i + 1];
      i++;
    } else if (arg === '--api-token' && i + 1 < args.length) {
      config.apiToken = args[i + 1];
      i++;
    } else if (arg === '--api-port' && i + 1 < args.length) {
      config.apiPort = args[i + 1];
      i++;
    } else if (arg === '--api-host' && i + 1 < args.length) {
      config.apiHost = args[i + 1];
      i++;
    } else if (arg === '--transport' && i + 1 < args.length) {
      config.transport = args[i + 1];
      i++;
    } else if (arg === '--http-port' && i + 1 < args.length) {
      config.httpPort = args[i + 1];
      i++;
    } else if (arg === '--http-host' && i + 1 < args.length) {
      config.httpHost = args[i + 1];
      i++;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Obsidian MCP Server

Usage: obsidian-mcp [options]

Options:
  --vault-path <path>   Path to your Obsidian vault
  --api-token <token>   API token for Obsidian Local REST API plugin
  --api-port <port>     API port (default: 27123)
  --api-host <host>     API host (default: 127.0.0.1)
  --transport <mode>    Transport mode: stdio or http (default: stdio)
  --http-port <port>    HTTP server port for SSE transport (default: 3000)
  --http-host <host>    HTTP server host for SSE transport (default: 127.0.0.1)
  --help, -h            Show this help message

Environment variables:
  OBSIDIAN_VAULT_PATH   Path to your Obsidian vault
  OBSIDIAN_API_TOKEN    API token for Obsidian Local REST API plugin
  OBSIDIAN_API_PORT     API port (default: 27123)
  OBSIDIAN_API_HOST     API host (default: 127.0.0.1)
  OBSIDIAN_TRANSPORT    Transport mode: stdio or http (default: stdio)
  OBSIDIAN_HTTP_PORT    HTTP server port for SSE transport (default: 3000)
  OBSIDIAN_HTTP_HOST    HTTP server host for SSE transport (default: 127.0.0.1)

Examples:
  obsidian-mcp --vault-path "/path/to/vault" --api-token "your-token"
  obsidian-mcp --transport http --http-port 8080 --vault-path "/path/to/vault"
  OBSIDIAN_VAULT_PATH="/path/to/vault" OBSIDIAN_API_TOKEN="token" obsidian-mcp
`);
      process.exit(0);
    }
  }

  return config;
}

// Helper functions for file editing
function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

// Helper functions for auto backlink functionality
interface NoteInfo {
  path: string;
  name: string;
  nameWithoutExt: string;
}

type SearchMatchType = 'filename' | 'content' | 'both';
type SearchSortBy = 'score' | 'path';
type SortDirection = 'asc' | 'desc';

interface SearchVaultOptions {
  limit: number;
  offset: number;
  pathPrefix?: string;
  extensions?: string[];
  matchType: SearchMatchType;
  sortBy: SearchSortBy;
  sortDirection: SortDirection;
}

function buildNoteIndex(filePaths: string[]): NoteInfo[] {
  const noteIndex: NoteInfo[] = [];
  
  for (const filePath of filePaths) {
    const name = path.basename(filePath);
    const nameWithoutExt = path.basename(filePath, path.extname(filePath));
    
    // Only include markdown files for now
    if (path.extname(filePath) === '.md') {
      noteIndex.push({
        path: filePath,
        name: name,
        nameWithoutExt: nameWithoutExt
      });
    }
  }
  
  // Sort by name length (descending) to match longer names first
  return noteIndex.sort((a, b) => b.nameWithoutExt.length - a.nameWithoutExt.length);
}

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function createBacklinkMatches(content: string, noteIndex: NoteInfo[], options: {
  minLength: number;
  caseSensitive: boolean;
  wholeWords: boolean;
}): { oldText: string; newText: string; notePath: string }[] {
  const matches: { oldText: string; newText: string; notePath: string }[] = [];
  
  if (!content || content.trim().length === 0) {
    return matches;
  }
  
  let processedContent = content;
  
  // Skip content that's already in wikilinks, markdown links, or code blocks
  const skipPatterns = [
    /```[\s\S]*?```/g,           // Code blocks
    /`[^`]*`/g,                  // Inline code
    /\[\[[^\]]*\]\]/g,           // Existing wikilinks
    /\[[^\]]*\]\([^)]*\)/g,      // Markdown links
    /https?:\/\/[^\s]*/g,        // URLs
    /!\[\[[^\]]*\]\]/g,          // Embedded wikilinks (images, etc)
  ];
  
  // Create a map of regions to skip
  const skipRegions: { start: number; end: number }[] = [];
  
  for (const pattern of skipPatterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      skipRegions.push({ start: match.index, end: match.index + match[0].length });
    }
  }
  
  // Sort skip regions by start position
  skipRegions.sort((a, b) => a.start - b.start);
  
  // Function to check if a position is in a skip region
  function isInSkipRegion(start: number, end: number): boolean {
    return skipRegions.some(region => 
      (start >= region.start && start < region.end) ||
      (end > region.start && end <= region.end) ||
      (start <= region.start && end >= region.end)
    );
  }
  
  // Process each note in the index
  for (const note of noteIndex) {
    if (note.nameWithoutExt.length < options.minLength) {
      continue;
    }
    
    // Skip very common words to avoid over-linking
    const commonWords = ['the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'up', 'about', 'into', 'over', 'after'];
    if (commonWords.includes(note.nameWithoutExt.toLowerCase())) {
      continue;
    }
    
    const flags = options.caseSensitive ? 'g' : 'gi';
    const boundary = options.wholeWords ? '\\b' : '';
    const escapedName = escapeRegExp(note.nameWithoutExt);
    
    try {
      const regex = new RegExp(`${boundary}${escapedName}${boundary}`, flags);
      
      let match;
      while ((match = regex.exec(processedContent)) !== null) {
        const matchStart = match.index;
        const matchEnd = match.index + match[0].length;
        
        // Skip if this match is in a skip region
        if (isInSkipRegion(matchStart, matchEnd)) {
          continue;
        }
        
        // Check if this text is already a wikilink or part of one
        const beforeMatch = processedContent.substring(Math.max(0, matchStart - 2), matchStart);
        const afterMatch = processedContent.substring(matchEnd, Math.min(processedContent.length, matchEnd + 2));
        
        if (beforeMatch.includes('[[') || afterMatch.includes(']]')) {
          continue;
        }
        
        // Additional check for potential false positives
        // Skip if the match is within a word (for non-word-boundary matches)
        if (!options.wholeWords) {
          const charBefore = matchStart > 0 ? processedContent[matchStart - 1] : ' ';
          const charAfter = matchEnd < processedContent.length ? processedContent[matchEnd] : ' ';
          
          if (/\w/.test(charBefore) || /\w/.test(charAfter)) {
            continue;
          }
        }
        
        matches.push({
          oldText: match[0],
          newText: `[[${note.nameWithoutExt}]]`,
          notePath: note.path
        });
        
        // Replace the matched text in processedContent to avoid overlapping matches
        processedContent = processedContent.substring(0, matchStart) + 
                          `[[${note.nameWithoutExt}]]` + 
                          processedContent.substring(matchEnd);
        
        // Reset regex lastIndex due to content change
        regex.lastIndex = matchStart + `[[${note.nameWithoutExt}]]`.length;
      }
    } catch (error) {
      console.warn(`Error processing regex for note "${note.nameWithoutExt}": ${error}`);
      continue;
    }
  }
  
  return matches;
}

// Batch processing function for auto backlink
async function processVaultBacklinks(
  listVaultFiles: () => Promise<string[]>,
  readNote: (path: string) => Promise<string>,
  options: {
    dryRun: boolean;
    excludePatterns: string[];
    minLength: number;
    caseSensitive: boolean;
    wholeWords: boolean;
    batchSize: number;
  }
): Promise<{
  totalNotes: number;
  processedNotes: number;
  modifiedNotes: number;
  totalLinksAdded: number;
  errors: string[];
  changes: { path: string; oldText: string; newText: string }[];
}> {
  const results = {
    totalNotes: 0,
    processedNotes: 0,
    modifiedNotes: 0,
    totalLinksAdded: 0,
    errors: [] as string[],
    changes: [] as { path: string; oldText: string; newText: string }[]
  };
  
  try {
    // Start vault processing
    
    // Get all notes in the vault
    const allFiles = await listVaultFiles();
    // Found files in vault
    
    const noteIndex = buildNoteIndex(allFiles);
    // Built note index
    
    // Filter out excluded patterns
    const filteredNotes = noteIndex.filter(note => {
      return !options.excludePatterns.some(pattern => {
        const regex = new RegExp(pattern.replace(/\*/g, '.*'));
        return regex.test(note.path);
      });
    });
    
    results.totalNotes = filteredNotes.length;
    // Filtered notes for processing
    
    // Process notes in batches
    for (let i = 0; i < filteredNotes.length; i += options.batchSize) {
      // Processing batch
      // Batch processing range
      
      const batch = filteredNotes.slice(i, i + options.batchSize);
      
      // Process each note in the batch
      for (const note of batch) {
        try {
          // Processing note
          const content = await readNote(note.path);
          // Read note content
          
          // Create backlink matches for this note
          const matches = createBacklinkMatches(content, noteIndex, {
            minLength: options.minLength,
            caseSensitive: options.caseSensitive,
            wholeWords: options.wholeWords
          });
          // Found potential matches
          
          // Filter out self-references
          const validMatches = matches.filter(match => match.notePath !== note.path);
          // Filtered self-references
          
          if (validMatches.length > 0) {
            // Valid matches found
            results.modifiedNotes++;
            results.totalLinksAdded += validMatches.length;
            
            // Convert matches to edit operations
            const edits = validMatches.map(match => ({
              oldText: match.oldText,
              newText: match.newText
            }));
            
            // Record changes for reporting
            validMatches.forEach(match => {
              results.changes.push({
                path: note.path,
                oldText: match.oldText,
                newText: match.newText
              });
            });
            
            // Apply changes if not dry run
            if (!options.dryRun) {
              await applyNoteEdits(note.path, edits);
            }
          }
          
          results.processedNotes++;
          
        } catch (error) {
          const errorMessage = `Error processing note ${note.path}: ${error instanceof Error ? error.message : String(error)}`;
          results.errors.push(errorMessage);
          console.error(errorMessage);
        }
      }
      
      // Small delay between batches to avoid overwhelming the system
      if (i + options.batchSize < filteredNotes.length) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
    
  } catch (error) {
    const errorMessage = `Error in vault processing: ${error instanceof Error ? error.message : String(error)}`;
    results.errors.push(errorMessage);
    console.error(errorMessage);
  }
  
  return results;
}

function createUnifiedDiff(originalContent: string, newContent: string, filepath: string): string {
  const normalizedOriginal = normalizeLineEndings(originalContent);
  const normalizedNew = normalizeLineEndings(newContent);
  
  return createTwoFilesPatch(
    filepath,
    filepath,
    normalizedOriginal,
    normalizedNew,
    'original',
    'modified'
  );
}

interface EditOperation {
  // 原有的替换模式
  oldText?: string;
  newText?: string;
  
  // 新增的插入模式
  expectedCount?: number;
  mode?: 'replace' | 'insert' | 'replaceRange';
  heading?: string;        // 目标标题
  content?: string;        // 要插入的内容
  position?: 'before' | 'after' | 'append' | 'prepend';
  level?: number;          // 标题级别 (1-6)
  blockId?: string;        // 块ID引用
}

// Markdown 元素结构
interface MarkdownElement {
  type: 'heading' | 'paragraph' | 'list' | 'code' | 'block';
  level?: number;          // 标题级别
  content: string;         // 内容
  startLine: number;       // 开始行号
  endLine: number;         // 结束行号
  blockId?: string;        // 块ID
}

// 解析 Markdown 内容
interface EditOperation {
  startLine?: number;
  endLine?: number;
  newContent?: string;
}

interface FileState {
  hash: string;
  mtimeMs: number;
  mtime: string;
  ctimeMs: number;
  ctime: string;
  size: number;
}

interface FrontmatterParseResult {
  properties: Record<string, any>;
  body: string;
  hasFrontmatter: boolean;
}

interface AppliedEditResult {
  index: number;
  mode: string;
  status: 'applied' | 'skipped';
  target?: string;
  matchCount?: number;
  line?: number;
  startLine?: number;
  endLine?: number;
  message: string;
}

interface ApplyNoteEditsResult {
  path: string;
  dryRun: boolean;
  changed: boolean;
  edits: AppliedEditResult[];
  diff?: string;
  message: string;
}

type BaseFilter = string | { and?: BaseFilter[]; or?: BaseFilter[]; not?: BaseFilter[] };

interface BaseView {
  type: string;
  name: string;
  limit?: number;
  groupBy?: { property: string; direction?: 'ASC' | 'DESC' };
  filters?: BaseFilter;
  order?: string[];
  summaries?: Record<string, string>;
  [key: string]: any;
}

interface BaseDocument {
  filters?: BaseFilter;
  formulas?: Record<string, string>;
  properties?: Record<string, any>;
  summaries?: Record<string, string>;
  views?: BaseView[];
  [key: string]: any;
}

function parseMarkdown(content: string): MarkdownElement[] {
  const lines = content.split('\n');
  const elements: MarkdownElement[] = [];
  let currentElement: MarkdownElement | null = null;
  let inCodeBlock = false;
  let codeBlockFence = '';
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();
    
    // 检查代码块
    if (trimmedLine.startsWith('```') || trimmedLine.startsWith('~~~')) {
      if (!inCodeBlock) {
        // 开始代码块
        inCodeBlock = true;
        codeBlockFence = trimmedLine.substring(0, 3);
        currentElement = {
          type: 'code',
          content: line,
          startLine: i,
          endLine: i
        };
      } else if (trimmedLine.startsWith(codeBlockFence)) {
        // 结束代码块
        inCodeBlock = false;
        if (currentElement) {
          currentElement.content += '\n' + line;
          currentElement.endLine = i;
          elements.push(currentElement);
          currentElement = null;
        }
      } else if (currentElement) {
        // 代码块内容
        currentElement.content += '\n' + line;
      }
      continue;
    }
    
    // 在代码块内，跳过其他处理
    if (inCodeBlock) {
      if (currentElement) {
        currentElement.content += '\n' + line;
      }
      continue;
    }
    
    // 检查标题
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      // 完成之前的元素
      if (currentElement) {
        currentElement.endLine = i - 1;
        elements.push(currentElement);
      }
      
      // 检查块ID
      const blockIdMatch = headingMatch[2].match(/^(.+?)\s*\^([a-zA-Z0-9-_]+)$/);
      const headingText = blockIdMatch ? blockIdMatch[1].trim() : headingMatch[2].trim();
      const blockId = blockIdMatch ? blockIdMatch[2] : undefined;
      
      currentElement = {
        type: 'heading',
        level: headingMatch[1].length,
        content: headingText,
        startLine: i,
        endLine: i,
        blockId: blockId
      };
      elements.push(currentElement);
      currentElement = null;
      continue;
    }
    
    // 检查块ID（独立的块ID）
    const blockIdMatch = line.match(/^\s*\^([a-zA-Z0-9-_]+)\s*$/);
    if (blockIdMatch) {
      // 如果前面有段落，给它添加块ID
      if (elements.length > 0) {
        const lastElement = elements[elements.length - 1];
        if (lastElement.type === 'paragraph' && !lastElement.blockId) {
          lastElement.blockId = blockIdMatch[1];
          lastElement.endLine = i;
        }
      }
      continue;
    }
    
    // 检查列表项
    const listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+(.+)$/);
    if (listMatch) {
      if (currentElement?.type !== 'list') {
        // 完成之前的元素
        if (currentElement) {
          currentElement.endLine = i - 1;
          elements.push(currentElement);
        }
        
        // 开始新的列表
        currentElement = {
          type: 'list',
          content: line,
          startLine: i,
          endLine: i
        };
      } else {
        // 继续列表
        currentElement.content += '\n' + line;
        currentElement.endLine = i;
      }
      continue;
    }
    
    // 空行处理
    if (trimmedLine === '') {
      if (currentElement) {
        currentElement.endLine = i - 1;
        elements.push(currentElement);
        currentElement = null;
      }
      continue;
    }
    
    // 段落处理
    if (currentElement?.type === 'paragraph') {
      currentElement.content += '\n' + line;
      currentElement.endLine = i;
    } else {
      // 完成之前的元素
      if (currentElement) {
        currentElement.endLine = i - 1;
        elements.push(currentElement);
      }
      
      // 开始新段落
      currentElement = {
        type: 'paragraph',
        content: line,
        startLine: i,
        endLine: i
      };
    }
  }
  
  // 完成最后的元素
  if (currentElement) {
    currentElement.endLine = lines.length - 1;
    elements.push(currentElement);
  }

  for (let i = 0; i < lines.length; i++) {
    const inlineBlock = lines[i].match(/(?:^|\s)\^([A-Za-z0-9-_]+)\s*$/);
    if (inlineBlock) {
      const owner = [...elements]
        .reverse()
        .find((element) => element.type !== 'code' && element.startLine <= i && element.endLine >= i);
      if (owner && !owner.blockId) {
        owner.blockId = inlineBlock[1];
        owner.content = owner.content.replace(/\s*\^[A-Za-z0-9-_]+\s*$/, '');
      }
    }

    const standaloneBlock = lines[i].match(/^\s*\^([A-Za-z0-9-_]+)\s*$/);
    if (standaloneBlock) {
      const previous = [...elements]
        .reverse()
        .find((element) => element.type !== 'code' && element.endLine < i);
      if (previous && !previous.blockId) {
        previous.blockId = standaloneBlock[1];
        previous.endLine = i;
      }
    }
  }
  
  return elements;
}

// 查找标题位置
function findHeadingPosition(
  elements: MarkdownElement[], 
  heading: string, 
  level?: number
): { index: number; element: MarkdownElement } | null {
  const lowerHeading = heading.toLowerCase().trim();
  
  // 先尝试精确匹配
  for (let i = 0; i < elements.length; i++) {
    const element = elements[i];
    if (element.type === 'heading') {
      // 级别过滤
      if (level && element.level !== level) {
        continue;
      }
      
      // 精确匹配
      if (element.content.toLowerCase().trim() === lowerHeading) {
        return { index: i, element };
      }
    }
  }
  
  // 如果精确匹配失败，尝试模糊匹配
  for (let i = 0; i < elements.length; i++) {
    const element = elements[i];
    if (element.type === 'heading') {
      // 级别过滤
      if (level && element.level !== level) {
        continue;
      }
      
      // 包含匹配
      if (element.content.toLowerCase().includes(lowerHeading)) {
        return { index: i, element };
      }
    }
  }
  
  // 最后尝试更宽松的匹配（移除特殊字符）
  const normalizedHeading = lowerHeading.replace(/[^\w\s]/g, '').replace(/\s+/g, ' ');
  for (let i = 0; i < elements.length; i++) {
    const element = elements[i];
    if (element.type === 'heading') {
      // 级别过滤
      if (level && element.level !== level) {
        continue;
      }
      
      // 标准化后匹配
      const normalizedContent = element.content.toLowerCase()
        .replace(/[^\w\s]/g, '').replace(/\s+/g, ' ');
      if (normalizedContent.includes(normalizedHeading)) {
        return { index: i, element };
      }
    }
  }
  
  return null;
}

// 查找块ID位置
function findBlockIdPosition(
  elements: MarkdownElement[], 
  blockId: string
): { index: number; element: MarkdownElement } | null {
  for (let i = 0; i < elements.length; i++) {
    const element = elements[i];
    if (element.blockId === blockId) {
      return { index: i, element };
    }
  }
  return null;
}

// 计算插入位置
function calculateInsertPosition(
  elements: MarkdownElement[],
  targetIndex: number,
  position: 'before' | 'after' | 'append' | 'prepend'
): number {
  const targetElement = elements[targetIndex];
  
  switch (position) {
    case 'before':
      return targetElement.startLine;
    
    case 'after':
      return targetElement.endLine + 1;
    
    case 'prepend':
      // 在标题下的第一行插入
      if (targetElement.type === 'heading') {
        return targetElement.endLine + 1;
      }
      return targetElement.startLine;
    
    case 'append':
      // 在标题对应章节的末尾插入
      if (targetElement.type === 'heading') {
        return findSectionEnd(elements, targetIndex);
      }
      return targetElement.endLine + 1;
    
    default:
      return targetElement.endLine + 1;
  }
}

// 查找章节结束位置
function findSectionEnd(elements: MarkdownElement[], headingIndex: number): number {
  const headingElement = elements[headingIndex];
  if (headingElement.type !== 'heading') {
    return headingElement.endLine + 1;
  }
  
  const headingLevel = headingElement.level!;
  
  // 查找下一个同级或更高级的标题
  for (let i = headingIndex + 1; i < elements.length; i++) {
    const element = elements[i];
    if (element.type === 'heading' && element.level! <= headingLevel) {
      // 找到下一个同级或更高级标题，在它前面插入
      return element.startLine;
    }
  }
  
  // 如果没找到，说明是最后一个章节，在文档末尾插入
  return elements.length > 0 ? elements[elements.length - 1].endLine + 1 : 0;
}

// 插入内容到指定行
function insertContentAtLine(
  lines: string[],
  targetLine: number,
  content: string
): string[] {
  const newLines = content.split('\n');
  const result = [...lines];
  
  // 确保插入位置有效
  const insertIndex = Math.max(0, Math.min(targetLine, lines.length));
  
  // 在指定位置插入新内容
  result.splice(insertIndex, 0, ...newLines);
  
  return result;
}

// 自定义错误类
class InsertError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly target: string
  ) {
    super(`${operation} failed: ${message} (target: ${target})`);
    this.name = 'InsertError';
  }
}

// 验证编辑操作
function validateEditOperation(edit: EditOperation): string[] {
  const errors: string[] = [];
  
  const mode = edit.mode || 'replace';
  
  if (mode === 'replace') {
    // 替换模式验证
    if (!edit.oldText) {
      errors.push('Replace mode requires oldText');
    }
    if (!edit.newText) {
      errors.push('Replace mode requires newText');
    }
  } else if (mode === 'insert') {
    // 插入模式验证
    if (edit.heading && edit.blockId) {
      errors.push('Insert mode cannot have both heading and blockId');
    }
    if (!edit.content) {
      errors.push('Insert mode requires content');
    }
    if (edit.level && (edit.level < 1 || edit.level > 6)) {
      errors.push('Heading level must be between 1 and 6');
    }
    if (edit.position && !['before', 'after', 'append', 'prepend'].includes(edit.position)) {
      errors.push('Position must be one of: before, after, append, prepend');
    }
  } else if (mode === 'replaceRange') {
    if (!edit.startLine || !edit.endLine) {
      errors.push('Replace range mode requires startLine and endLine');
    }
    if (edit.newContent === undefined && edit.content === undefined) {
      errors.push('Replace range mode requires newContent');
    }
  } else {
    errors.push(`Unknown mode: ${mode}`);
  }
  
  return errors;
}

// 处理插入操作
function handleInsertEdit(
  lines: string[], 
  elements: MarkdownElement[], 
  edit: EditOperation
): string[] {
  // 验证操作
  const validationErrors = validateEditOperation(edit);
  if (validationErrors.length > 0) {
    throw new InsertError(
      validationErrors.join('; '),
      'validation',
      edit.heading || edit.blockId || 'unknown'
    );
  }
  
  let targetIndex = -1;
  let targetElement: MarkdownElement | null = null;
  
  try {
    if (edit.heading) {
      // 标题插入模式
      const headingResult = findHeadingPosition(elements, edit.heading, edit.level);
      if (!headingResult) {
        throw new InsertError(
          `Heading not found: ${edit.heading}${edit.level ? ` (level ${edit.level})` : ''}`,
          'heading_search',
          edit.heading
        );
      }
      targetIndex = headingResult.index;
      targetElement = headingResult.element;
      
    } else if (edit.blockId) {
      // 块插入模式
      const blockResult = findBlockIdPosition(elements, edit.blockId);
      if (!blockResult) {
        throw new InsertError(
          `Block ID not found: ${edit.blockId}`,
          'block_search',
          edit.blockId
        );
      }
      targetIndex = blockResult.index;
      targetElement = blockResult.element;
    }
    
    // 计算插入位置
    if (targetIndex === -1) {
      const documentPosition = edit.position === 'before' || edit.position === 'prepend' ? 0 : lines.length;
      return insertContentAtLine(lines, documentPosition, edit.content || '');
    }

    const insertLine = calculateInsertPosition(elements, targetIndex, edit.position || 'after');
    
    // 插入内容
    return insertContentAtLine(lines, insertLine, edit.content || '');
    
  } catch (error) {
    if (error instanceof InsertError) {
      throw error;
    }
    throw new InsertError(
      error instanceof Error ? error.message : String(error),
      'insert_operation',
      edit.heading || edit.blockId || 'unknown'
    );
  }
}

async function applyNoteEdits(filePath: string, edits: EditOperation[], dryRun: boolean = false): Promise<string> {
  const fullPath = path.join(VAULT_PATH, filePath);
  
  // Read current file content
  let content: string;
  try {
    content = fs.readFileSync(fullPath, 'utf-8');
  } catch (error) {
    throw new Error(`Failed to read file ${filePath}: ${error}`);
  }
  
  const originalContent = content;
  let modifiedContent = normalizeLineEndings(content);
  
  // Parse markdown structure for insert operations
  const elements = parseMarkdown(modifiedContent);
  let lines = modifiedContent.split('\n');
  
  // Apply edits sequentially
  for (const edit of edits) {
    // 向后兼容：如果没有mode字段但有oldText和newText，默认为replace模式
    const mode = edit.mode || (edit.oldText && edit.newText ? 'replace' : 'insert');
    
    // 验证编辑操作
    const validationErrors = validateEditOperation({ ...edit, mode });
    if (validationErrors.length > 0) {
      throw new Error(`Invalid edit operation: ${validationErrors.join('; ')}`);
    }
    
    if (mode === 'insert') {
      // Handle insert mode
      try {
        lines = handleInsertEdit(lines, elements, edit);
        modifiedContent = lines.join('\n');
        // Re-parse elements after modification for subsequent edits
        elements.length = 0;
        elements.push(...parseMarkdown(modifiedContent));
      } catch (error) {
        if (error instanceof InsertError) {
          throw new Error(`Insert operation failed: ${error.message}`);
        }
        throw new Error(`Insert operation failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      // Handle replace mode (original logic)
      const { oldText, newText } = edit;
      
      if (!oldText || !newText) {
        throw new Error('Replace mode requires both oldText and newText');
      }
      
      if (oldText === newText) {
        continue; // Skip if no change
      }
      
      // Try exact match first
      if (modifiedContent.includes(oldText)) {
        modifiedContent = modifiedContent.replace(oldText, newText);
        lines = modifiedContent.split('\n');
        // Re-parse elements after modification
        elements.length = 0;
        elements.push(...parseMarkdown(modifiedContent));
        continue;
      }
      
      // Try flexible line-by-line matching
      const oldLines = oldText.split('\n');
      const newLines = newText.split('\n');
      let matchFound = false;
      
      // Find matching sequence of lines
      for (let i = 0; i <= lines.length - oldLines.length; i++) {
        let isMatch = true;
        const matchedIndentations: string[] = [];
        
        // Check if lines match (ignoring leading/trailing whitespace)
        for (let j = 0; j < oldLines.length; j++) {
          const contentLine = lines[i + j];
          const oldLine = oldLines[j];
          
          // Extract indentation from content line
          const indentMatch = contentLine.match(/^(\s*)/);
          const indentation = indentMatch ? indentMatch[1] : '';
          matchedIndentations.push(indentation);
          
          // Compare trimmed lines
          if (contentLine.trim() !== oldLine.trim()) {
            isMatch = false;
            break;
          }
        }
        
        if (isMatch) {
          // Replace the matched lines with new lines, preserving indentation
          const replacementLines = newLines.map((line, index) => {
            if (index < matchedIndentations.length) {
              const originalIndent = matchedIndentations[index];
              const lineWithoutIndent = line.replace(/^\s*/, '');
              return originalIndent + lineWithoutIndent;
            }
            return line;
          });
          
          // Replace the lines
          lines.splice(i, oldLines.length, ...replacementLines);
          modifiedContent = lines.join('\n');
          matchFound = true;
          // Re-parse elements after modification
          elements.length = 0;
          elements.push(...parseMarkdown(modifiedContent));
          break;
        }
      }
      
      if (!matchFound) {
        throw new Error(`Could not find matching text for edit: "${oldText.substring(0, 50)}..."`);
      }
    }
  }
  
  if (dryRun) {
    // Return diff for preview
    return createUnifiedDiff(originalContent, modifiedContent, filePath);
  }
  
  // Write the modified content atomically
  const tempFile = fullPath + '.tmp';
  try {
    fs.writeFileSync(tempFile, modifiedContent, 'utf-8');
    fs.renameSync(tempFile, fullPath);
  } catch (error) {
    // Clean up temp file if it exists
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
    throw new Error(`Failed to write file ${filePath}: ${error}`);
  }
  
  return `File ${filePath} updated successfully`;
}

function countOccurrences(content: string, search: string): number {
  return search ? content.split(search).length - 1 : 0;
}

async function applyNoteEditsV2(filePath: string, edits: EditOperation[], dryRun: boolean = false): Promise<ApplyNoteEditsResult> {
  const originalContent = readTextFile(filePath);
  let modifiedContent = normalizeLineEndings(originalContent);
  const results: AppliedEditResult[] = [];
  let elements = parseMarkdown(modifiedContent);
  let lines = modifiedContent.split('\n');

  for (let index = 0; index < edits.length; index++) {
    const edit = edits[index];
    const mode = edit.mode || (edit.oldText !== undefined && edit.newText !== undefined ? 'replace' : 'insert');

    if (mode === 'replaceRange') {
      const startLine = Number(edit.startLine);
      const endLine = Number(edit.endLine);
      if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine || endLine > lines.length) {
        throw new Error(`Invalid replaceRange edit ${index}: startLine/endLine must be valid 1-based inclusive line numbers`);
      }

      const replacement = (edit.newContent ?? edit.content ?? '').split('\n');
      lines.splice(startLine - 1, endLine - startLine + 1, ...replacement);
      modifiedContent = lines.join('\n');
      elements = parseMarkdown(modifiedContent);
      results.push({ index, mode, status: 'applied', startLine, endLine, message: `Replaced lines ${startLine}-${endLine}` });
      continue;
    }

    const validationErrors = validateEditOperation({ ...edit, mode });
    if (validationErrors.length > 0) {
      throw new Error(`Invalid edit operation ${index}: ${validationErrors.join('; ')}`);
    }

    if (mode === 'insert') {
      lines = handleInsertEdit(lines, elements, edit);
      modifiedContent = lines.join('\n');
      elements = parseMarkdown(modifiedContent);
      results.push({
        index,
        mode,
        status: 'applied',
        target: edit.heading || edit.blockId,
        message: `Inserted content ${edit.position || 'after'} ${edit.heading ? `heading "${edit.heading}"` : `block "${edit.blockId}"`}`,
      });
      continue;
    }

    const oldText = edit.oldText ?? '';
    const newText = edit.newText ?? '';
    const expectedCount = edit.expectedCount !== undefined ? Number(edit.expectedCount) : 1;
    if (!Number.isInteger(expectedCount) || expectedCount < 0) {
      throw new Error(`Invalid replace edit ${index}: expectedCount must be a non-negative integer`);
    }

    const exactCount = countOccurrences(modifiedContent, oldText);
    if (exactCount > 0) {
      if (exactCount !== expectedCount) {
        throw new Error(`Replace edit ${index} expected ${expectedCount} match(es) but found ${exactCount}`);
      }
      modifiedContent = modifiedContent.split(oldText).join(newText);
      lines = modifiedContent.split('\n');
      elements = parseMarkdown(modifiedContent);
      results.push({ index, mode, status: oldText === newText ? 'skipped' : 'applied', matchCount: exactCount, message: `Replaced ${exactCount} exact match(es)` });
      continue;
    }

    const oldLines = oldText.split('\n');
    const newLines = newText.split('\n');
    const matches: { start: number; indentations: string[] }[] = [];
    for (let i = 0; i <= lines.length - oldLines.length; i++) {
      const indentations: string[] = [];
      let isMatch = true;
      for (let j = 0; j < oldLines.length; j++) {
        const indentation = lines[i + j].match(/^(\s*)/)?.[1] || '';
        indentations.push(indentation);
        if (lines[i + j].trim() !== oldLines[j].trim()) {
          isMatch = false;
          break;
        }
      }
      if (isMatch) {
        matches.push({ start: i, indentations });
      }
    }

    if (matches.length !== expectedCount) {
      throw new Error(`Replace edit ${index} expected ${expectedCount} flexible match(es) but found ${matches.length}`);
    }

    for (const match of [...matches].reverse()) {
      const replacementLines = newLines.map((line, lineIndex) => {
        if (lineIndex < match.indentations.length) {
          return match.indentations[lineIndex] + line.replace(/^\s*/, '');
        }
        return line;
      });
      lines.splice(match.start, oldLines.length, ...replacementLines);
    }

    modifiedContent = lines.join('\n');
    elements = parseMarkdown(modifiedContent);
    results.push({ index, mode, status: oldText === newText ? 'skipped' : 'applied', matchCount: matches.length, message: `Replaced ${matches.length} flexible match(es)` });
  }

  const changed = normalizeLineEndings(originalContent) !== modifiedContent;
  const result: ApplyNoteEditsResult = {
    path: filePath,
    dryRun,
    changed,
    edits: results,
    message: changed ? `File ${filePath} ${dryRun ? 'would be updated' : 'updated successfully'}` : `File ${filePath} unchanged`,
  };
  if (changed) {
    result.diff = createUnifiedDiff(originalContent, modifiedContent, filePath);
  }
  if (!dryRun && changed) {
    writeTextFileAtomic(filePath, modifiedContent);
  }
  return result;
}

// Obsidian API configuration
const CONFIG = parseCliArgs();
// Ensure vault path is absolute
const VAULT_PATH = path.isAbsolute(CONFIG.vaultPath) 
  ? CONFIG.vaultPath 
  : path.resolve(process.cwd(), CONFIG.vaultPath);
const API_TOKEN = CONFIG.apiToken;
const API_PORT = CONFIG.apiPort;
const API_HOST = CONFIG.apiHost;
const API_BASE_URL = `http://${API_HOST}:${API_PORT}`;
const TRANSPORT_MODE = CONFIG.transport;
const HTTP_PORT = parseInt(CONFIG.httpPort);
const HTTP_HOST = CONFIG.httpHost;

// Load exclusions from Obsidian settings
function loadExclusions(): string[] {
  const defaultExclusions = ['.obsidian/', '.git/', '.DS_Store'];
  try {
    const appJsonPath = path.join(VAULT_PATH, '.obsidian', 'app.json');
    if (fs.existsSync(appJsonPath)) {
      const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf-8'));
      if (appJson.userIgnoreFilters && Array.isArray(appJson.userIgnoreFilters)) {
        return [...defaultExclusions, ...appJson.userIgnoreFilters];
      }
    }
  } catch (error) {
    console.warn('Failed to load exclusions from app.json:', error);
  }
  return defaultExclusions;
}

const EXCLUSIONS = loadExclusions();
const GLOB_SPECIAL_CHARS = /[*?[\]{}()!+@]/;

function normalizeVaultPath(filePath: string, trimTrailingSlash: boolean = true): string {
  const normalized = filePath
    .replace(/\\/g, '/')
    .split(path.sep).join('/')
    .replace(/^\.?\//, '');
  return trimTrailingSlash ? normalized.replace(/\/+$/, '') : normalized;
}

function escapeRegexChar(char: string): string {
  return /[|\\{}()[\]^$+?.]/.test(char) ? `\\${char}` : char;
}

function globToRegExp(globPattern: string): RegExp {
  let regex = '^';
  let i = 0;

  while (i < globPattern.length) {
    const char = globPattern[i];

    if (char === '*') {
      const nextChar = globPattern[i + 1];
      if (nextChar === '*') {
        regex += '.*';
        i += 2;
        continue;
      }
      regex += '[^/]*';
      i++;
      continue;
    }

    if (char === '?') {
      regex += '[^/]';
      i++;
      continue;
    }

    regex += escapeRegexChar(char);
    i++;
  }

  regex += '$';

  return new RegExp(regex, process.platform === 'win32' ? 'i' : '');
}

function buildExclusionMatchers(patterns: string[]): RegExp[] {
  const matchers: RegExp[] = [];
  const seen = new Set<string>();

  const addMatcher = (pattern: string) => {
    const normalizedPattern = normalizeVaultPath(pattern);
    if (!normalizedPattern || seen.has(normalizedPattern)) {
      return;
    }
    seen.add(normalizedPattern);
    matchers.push(globToRegExp(normalizedPattern));
  };

  for (const pattern of patterns) {
    const normalizedPattern = normalizeVaultPath(pattern, false);
    if (!normalizedPattern) {
      continue;
    }

    const directoryPattern = normalizedPattern.endsWith('/');
    const trimmedPattern = directoryPattern
      ? normalizedPattern.slice(0, -1)
      : normalizedPattern;

    if (!trimmedPattern) {
      continue;
    }

    if (directoryPattern || pattern.endsWith('/')) {
      addMatcher(trimmedPattern);
      addMatcher(`${trimmedPattern}/**`);
      continue;
    }

    addMatcher(trimmedPattern);

    if (!trimmedPattern.includes('/') && !GLOB_SPECIAL_CHARS.test(trimmedPattern)) {
      addMatcher(`**/${trimmedPattern}`);
    }
  }

  return matchers;
}

const EXCLUSION_MATCHERS = buildExclusionMatchers(EXCLUSIONS);
const VAULT_GUIDE_URI = 'obsidian://vault-guide';

function isExcluded(filePath: string): boolean {
  // Always exclude common system files/folders regardless of location
  const basename = path.basename(filePath);
  if (basename === '.DS_Store' || basename === '.git') {
    return true;
  }

  const normalizedPath = normalizeVaultPath(filePath);
  if (!normalizedPath) {
    return false;
  }

  return EXCLUSION_MATCHERS.some((matcher) => matcher.test(normalizedPath));
}

function getVaultFullPath(filePath: string): string {
  const normalized = normalizeVaultPath(filePath);
  if (!normalized) {
    throw new Error('Path is required');
  }
  if (isExcluded(normalized)) {
    throw new Error(`Path is excluded or not found: ${filePath}`);
  }

  const fullPath = path.resolve(VAULT_PATH, normalized);
  const relativePath = path.relative(VAULT_PATH, fullPath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`Path escapes vault: ${filePath}`);
  }

  return fullPath;
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

function getFileState(filePath: string): FileState {
  const fullPath = getVaultFullPath(filePath);
  const stat = fs.statSync(fullPath);
  const content = fs.readFileSync(fullPath, 'utf-8');
  return {
    hash: sha256(content),
    mtimeMs: stat.mtimeMs,
    mtime: stat.mtime.toISOString(),
    ctimeMs: stat.ctimeMs,
    ctime: stat.ctime.toISOString(),
    size: stat.size,
  };
}

function assertExpectedState(filePath: string, expectedHash?: string, expectedMtime?: string | number): void {
  if (expectedHash === undefined && expectedMtime === undefined) {
    return;
  }

  const state = getFileState(filePath);
  if (expectedHash !== undefined && state.hash !== expectedHash) {
    throw new Error(`File has changed since read: expected hash ${expectedHash}, got ${state.hash}`);
  }
  if (expectedMtime !== undefined) {
    const expected = typeof expectedMtime === 'number' ? expectedMtime : Date.parse(expectedMtime);
    if (!Number.isFinite(expected)) {
      throw new Error('expectedMtime must be a millisecond timestamp or an ISO date string');
    }
    if (Math.abs(state.mtimeMs - expected) > 1) {
      throw new Error(`File has changed since read: expected mtime ${expectedMtime}, got ${state.mtime}`);
    }
  }
}

function readTextFile(filePath: string): string {
  return fs.readFileSync(getVaultFullPath(filePath), 'utf-8');
}

function writeTextFileAtomic(filePath: string, content: string): void {
  const fullPath = getVaultFullPath(filePath);
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tempFile = `${fullPath}.tmp`;
  try {
    fs.writeFileSync(tempFile, content, 'utf-8');
    fs.renameSync(tempFile, fullPath);
  } catch (error) {
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
    throw error;
  }
}

function parseFrontmatter(content: string): FrontmatterParseResult {
  const normalized = normalizeLineEndings(content);
  if (!normalized.startsWith('---\n')) {
    return { properties: {}, body: normalized, hasFrontmatter: false };
  }

  const endMatch = normalized.slice(4).match(/\n---\n?/);
  if (!endMatch || endMatch.index === undefined) {
    return { properties: {}, body: normalized, hasFrontmatter: false };
  }

  const yamlStart = 4;
  const yamlEnd = yamlStart + endMatch.index;
  const yamlText = normalized.slice(yamlStart, yamlEnd);
  const bodyStart = yamlEnd + endMatch[0].length;
  const parsed = YAML.parse(yamlText) || {};
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Frontmatter must be a YAML object');
  }

  return {
    properties: parsed as Record<string, any>,
    body: normalized.slice(bodyStart),
    hasFrontmatter: true,
  };
}

function serializeFrontmatter(properties: Record<string, any>, body: string): string {
  const keys = Object.keys(properties).filter((key) => properties[key] !== undefined);
  if (keys.length === 0) {
    return body.replace(/^\n+/, '');
  }
  const yamlText = YAML.stringify(properties).trimEnd();
  return `---\n${yamlText}\n---\n${body.replace(/^\n+/, '')}`;
}

function extractMarkdownMetadata(content: string) {
  const normalized = normalizeLineEndings(content);
  const frontmatter = parseFrontmatter(normalized);
  const body = frontmatter.body;
  const elements = parseMarkdown(body);
  const words = body.trim() ? body.trim().split(/\s+/).length : 0;
  const wikilinks = [...body.matchAll(/(?<!!)\[\[([^\]]+)\]\]/g)].map((match) => match[1]);
  const embeds = [...body.matchAll(/!\[\[([^\]]+)\]\]/g)].map((match) => match[1]);
  const markdownLinks = [...body.matchAll(/!?\[([^\]]*)\]\(([^)]+)\)/g)].map((match) => ({
    text: match[1],
    target: match[2],
  }));
  const inlineTags = [...body.matchAll(/(^|\s)#([A-Za-z][A-Za-z0-9_/-]*)/g)].map((match) => match[2]);
  const propertyTags = Array.isArray(frontmatter.properties.tags)
    ? frontmatter.properties.tags
    : typeof frontmatter.properties.tags === 'string'
      ? [frontmatter.properties.tags]
      : [];
  return {
    properties: frontmatter.properties,
    wordCount: words,
    headings: elements
      .filter((element) => element.type === 'heading')
      .map((element) => ({ level: element.level, text: element.content, line: element.startLine + 1, blockId: element.blockId || null })),
    blockIds: elements
      .filter((element) => element.blockId)
      .map((element) => ({ id: element.blockId, line: element.startLine + 1, type: element.type })),
    wikilinks,
    embeds,
    markdownLinks,
    tags: [...new Set([...propertyTags, ...inlineTags])],
  };
}

const BUILT_IN_BASE_VIEW_TYPES = new Set(['table', 'cards', 'list', 'map']);
const DEFAULT_BASE_SUMMARIES = new Set([
  'Average', 'Min', 'Max', 'Sum', 'Range', 'Median', 'Stddev',
  'Earliest', 'Latest', 'Checked', 'Unchecked', 'Empty', 'Filled', 'Unique',
]);

function parseBaseContent(content: string): BaseDocument {
  const parsed = YAML.parse(content) || {};
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Base content must be a YAML object');
  }
  return parsed as BaseDocument;
}

function serializeBase(base: BaseDocument): string {
  return YAML.stringify(base).trimEnd() + '\n';
}

function getFormulaReferences(value: any): string[] {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return [...text.matchAll(/\bformula\.([A-Za-z0-9_-]+)/g)].map((match) => match[1]);
}

function validateBaseFilter(filter: any, warnings: string[], errors: string[], pathLabel: string): void {
  if (filter === undefined || filter === null) {
    return;
  }
  if (typeof filter === 'string') {
    if (filter.includes('file.backlinks')) {
      warnings.push(`${pathLabel}: file.backlinks is performance-heavy; prefer file.links when possible.`);
    }
    return;
  }
  if (typeof filter !== 'object' || Array.isArray(filter)) {
    errors.push(`${pathLabel}: filter must be a string or an object with and/or/not`);
    return;
  }
  const keys = Object.keys(filter);
  const logicKeys = keys.filter((key) => ['and', 'or', 'not'].includes(key));
  if (logicKeys.length !== 1) {
    errors.push(`${pathLabel}: filter object must contain exactly one of and/or/not`);
    return;
  }
  const childFilters = filter[logicKeys[0]];
  if (!Array.isArray(childFilters)) {
    errors.push(`${pathLabel}.${logicKeys[0]}: must be an array`);
    return;
  }
  childFilters.forEach((child, index) => validateBaseFilter(child, warnings, errors, `${pathLabel}.${logicKeys[0]}[${index}]`));
}

function validateBaseDocument(base: BaseDocument) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const formulaNames = new Set(Object.keys(base.formulas || {}));

  validateBaseFilter(base.filters, warnings, errors, 'filters');

  if (base.formulas !== undefined && (typeof base.formulas !== 'object' || Array.isArray(base.formulas))) {
    errors.push('formulas must be an object mapping names to expression strings');
  } else {
    for (const [name, expression] of Object.entries(base.formulas || {})) {
      if (typeof expression !== 'string') {
        errors.push(`formula.${name} must be a string`);
      }
      if (expression.includes('file.backlinks')) {
        warnings.push(`formula.${name}: file.backlinks is performance-heavy; prefer file.links when possible.`);
      }
      for (const reference of getFormulaReferences(expression)) {
        if (!formulaNames.has(reference)) {
          errors.push(`formula.${name} references undefined formula.${reference}`);
        }
      }
      if (/\([^)]*-\s*[^)]*\)\s*\.\s*(round|floor|ceil)\s*\(/.test(expression) && !/\)\s*\.\s*(days|hours|minutes|seconds|milliseconds)\s*\.\s*(round|floor|ceil)\s*\(/.test(expression)) {
        warnings.push(`formula.${name}: date subtraction returns a duration; access .days/.hours/etc before numeric rounding.`);
      }
    }
  }

  if (!Array.isArray(base.views) || base.views.length === 0) {
    errors.push('views must be a non-empty array');
  } else {
    base.views.forEach((view, index) => {
      if (!view || typeof view !== 'object' || Array.isArray(view)) {
        errors.push(`views[${index}] must be an object`);
        return;
      }
      if (!view.type || typeof view.type !== 'string') {
        errors.push(`views[${index}].type is required`);
      } else if (!BUILT_IN_BASE_VIEW_TYPES.has(view.type)) {
        warnings.push(`views[${index}].type "${view.type}" is not a built-in type; assuming plugin-provided layout.`);
      }
      if (!view.name || typeof view.name !== 'string') {
        errors.push(`views[${index}].name is required`);
      }
      if (view.filters) {
        validateBaseFilter(view.filters, warnings, errors, `views[${index}].filters`);
      }
      for (const value of [...(view.order || []), ...Object.keys(view.summaries || {})]) {
        for (const reference of getFormulaReferences(value)) {
          if (!formulaNames.has(reference)) {
            errors.push(`views[${index}] references undefined formula.${reference}`);
          }
        }
      }
      for (const summary of Object.values(view.summaries || {})) {
        if (!DEFAULT_BASE_SUMMARIES.has(summary) && !(base.summaries || {})[summary]) {
          warnings.push(`views[${index}] uses unknown summary "${summary}"`);
        }
      }
    });
  }

  return { valid: errors.length === 0, errors, warnings };
}

function getNestedProperty(source: any, propertyPath: string): any {
  return propertyPath.split('.').reduce((value, key) => value?.[key], source);
}

function parseBaseLiteral(raw: string): any {
  const trimmed = raw.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  const numberValue = Number(trimmed);
  return Number.isNaN(numberValue) ? trimmed : numberValue;
}

function compareBaseValues(left: any, operator: string, right: any): boolean {
  const leftComparable = left instanceof Date ? left.getTime() : left;
  const rightComparable = right instanceof Date ? right.getTime() : right;
  switch (operator) {
    case '==': return leftComparable == rightComparable;
    case '!=': return leftComparable != rightComparable;
    case '>': return leftComparable > rightComparable;
    case '<': return leftComparable < rightComparable;
    case '>=': return leftComparable >= rightComparable;
    case '<=': return leftComparable <= rightComparable;
    default: return false;
  }
}

function getBaseValue(row: any, expression: string): any {
  const trimmed = expression.trim();
  if (trimmed.startsWith('file.')) {
    return getNestedProperty(row.file, trimmed.slice(5));
  }
  if (trimmed.startsWith('note.')) {
    return getNestedProperty(row.note, trimmed.slice(5));
  }
  if (trimmed.startsWith('formula.')) {
    return getNestedProperty(row.formula, trimmed.slice(8));
  }
  return getNestedProperty(row.note, trimmed);
}

function evaluateSimpleFormula(expression: string, row: any, warnings: string[]): any {
  const trimmed = expression.trim();
  const ageMatch = trimmed.match(/^\(?\s*now\(\)\s*-\s*file\.(m|c)time\s*\)?\.(days|hours|minutes|seconds|milliseconds)$/);
  if (ageMatch) {
    const dateValue = ageMatch[1] === 'm' ? row.file.mtime : row.file.ctime;
    const diffMs = Date.now() - new Date(dateValue).getTime();
    const divisors: Record<string, number> = {
      milliseconds: 1,
      seconds: 1000,
      minutes: 60_000,
      hours: 3_600_000,
      days: 86_400_000,
    };
    return diffMs / divisors[ageMatch[2]];
  }

  if (/^[A-Za-z0-9_.]+$/.test(trimmed)) {
    return getBaseValue(row, trimmed);
  }

  warnings.push(`Unsupported formula expression for MCP evaluation: ${expression}`);
  return null;
}

function evaluateBaseFilter(filter: BaseFilter | undefined, row: any, warnings: string[]): boolean {
  if (!filter) {
    return true;
  }
  if (typeof filter !== 'string') {
    if (filter.and) return filter.and.every((child) => evaluateBaseFilter(child, row, warnings));
    if (filter.or) return filter.or.some((child) => evaluateBaseFilter(child, row, warnings));
    if (filter.not) return !filter.not.some((child) => evaluateBaseFilter(child, row, warnings));
    warnings.push('Unsupported filter object; expected and/or/not');
    return false;
  }

  const statement = filter.trim();
  let match = statement.match(/^file\.inFolder\(["'](.+)["']\)$/);
  if (match) return row.file.folder === match[1] || row.file.folder.startsWith(`${match[1]}/`);

  match = statement.match(/^\/(.+)\/\.matches\((file\.(?:name|basename|path|folder))\)$/);
  if (match) return new RegExp(match[1]).test(String(getBaseValue(row, match[2]) ?? ''));

  match = statement.match(/^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
  if (match) {
    const left = getBaseValue(row, match[1]);
    const right = parseBaseLiteral(match[3]);
    return compareBaseValues(left, match[2], right);
  }

  match = statement.match(/^file\.hasTag\(["'](.+)["']\)$/);
  if (match) return Array.isArray(row.file.tags) && row.file.tags.includes(match[1]);

  warnings.push(`Unsupported filter expression for MCP evaluation: ${statement}`);
  return false;
}

function selectBaseView(base: BaseDocument, viewName?: string): BaseView {
  const views = base.views || [];
  const view = viewName ? views.find((candidate) => candidate.name === viewName) : views[0];
  if (!view) {
    throw new Error(viewName ? `Base view not found: ${viewName}` : 'Base has no views');
  }
  return view;
}

function formatWikilinkTarget(target: string, heading?: string, blockId?: string): string {
  let result = target;
  if (heading) {
    result += `#${heading}`;
  }
  if (blockId) {
    result += `#^${blockId.replace(/^\^/, '')}`;
  }
  return result;
}

function formatWikilink(target: string, alias?: string, heading?: string, blockId?: string, embed: boolean = false): string {
  const linkTarget = formatWikilinkTarget(target, heading, blockId);
  return `${embed ? '!' : ''}[[${linkTarget}${alias ? `|${alias}` : ''}]]`;
}

function buildCallout(type: string, content: string, title?: string, fold: 'expanded' | 'collapsed' | 'none' = 'none'): string {
  const foldMarker = fold === 'expanded' ? '+' : fold === 'collapsed' ? '-' : '';
  const titleText = title ? ` ${title}` : '';
  const lines = content.split('\n').map((line) => `> ${line}`);
  return `> [!${type}]${foldMarker}${titleText}\n${lines.join('\n')}`;
}

function appendContentAtTarget(content: string, addition: string, heading?: string, blockId?: string, position: 'before' | 'after' | 'append' | 'prepend' = 'append'): string {
  const elements = parseMarkdown(content);
  let lines = normalizeLineEndings(content).split('\n');
  const edit: EditOperation = { mode: 'insert', content: `${addition}\n`, position, heading, blockId };
  lines = handleInsertEdit(lines, elements, edit);
  return lines.join('\n');
}

// Configuration loaded

// Validate vault path exists
if (!fs.existsSync(VAULT_PATH)) {
  console.error(`[ERROR] Vault path does not exist: ${VAULT_PATH}`);
  console.error(`[ERROR] Please check your vault path configuration`);
  console.error(`[ERROR] Current working directory: ${process.cwd()}`);
}

class ObsidianMcpServer {
  private server: Server;
  private api: AxiosInstance;

  constructor() {
    // Initialize MCP server
    this.server = new Server(
      {
        name: 'obsidian-mcp-server',
        version: '0.1.0',
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        },
      }
    );

    // Initialize Obsidian API client
    this.api = axios.create({
      baseURL: API_BASE_URL,
      headers: {
        'Authorization': `Bearer ${API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000, // 10 second timeout
    });

    // Set up request handlers
    this.setupResourceHandlers();
    this.setupToolHandlers();
    
    // Error handling
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupResourceHandlers() {
    // List available resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      try {
        // Avoid dumping the full vault into context during resource discovery.
        return {
          resources: [
            {
              uri: VAULT_GUIDE_URI,
              name: 'Vault Discovery Guide',
              mimeType: 'text/plain',
              description: 'Use search_vault or scoped list_notes calls to discover notes without enumerating the entire vault.',
            },
          ],
        };
      } catch (error) {
        console.error('Error listing resources:', error);
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to list resources: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });

    // Read resource content
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      try {
        if (request.params.uri === VAULT_GUIDE_URI) {
          return {
            contents: [
              {
                uri: request.params.uri,
                mimeType: 'text/plain',
                text: [
                  'Obsidian vault resources are intentionally not enumerated by default.',
                  'Use search_vault for keyword-based discovery with pagination, filtering, and sorting.',
                  'Use list_notes with a specific folder and/or recursive=false when you want a narrower listing.',
                  'Use read_note once you know the target path.'
                ].join('\n'),
              },
            ],
          };
        }

        const match = request.params.uri.match(/^obsidian:\/\/(.+)$/);
        if (!match) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            `Invalid URI format: ${request.params.uri}`
          );
        }
        
        const filePath = decodeURIComponent(match[1]);
        const content = await this.readNote(filePath);
        
        return {
          contents: [
            {
              uri: request.params.uri,
              mimeType: 'text/markdown',
              text: content,
            },
          ],
        };
      } catch (error) {
        console.error('Error reading resource:', error);
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to read resource: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });
  }

  private setupToolHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'list_notes',
          description: 'List notes in the Obsidian vault. Prefer specifying a folder or setting recursive to false to avoid returning a very large vault-wide listing.',
          inputSchema: {
            type: 'object',
            properties: {
              folder: {
                type: 'string',
                description: 'Folder path within the vault (recommended). If omitted, listing starts from the vault root.',
              },
              recursive: {
                type: 'boolean',
                description: 'Whether to include files in subdirectories (default: true). Set to false for narrower, lower-context listings.',
                default: true,
              },
            },
            required: [],
          },
        },
        {
          name: 'delete_note',
          description: 'Delete a note from the Obsidian vault. Destructive operation: verify the path before calling.',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Path to the note within the vault',
              },
            },
            required: ['path'],
          },
        },
        {
          name: 'read_note',
          description: 'Read the content of a note in the Obsidian vault. Prefer get_note_metadata or search_vault when full body content is not needed.',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Path to the note within the vault',
              },
            },
            required: ['path'],
          },
        },
        {
          name: 'create_note',
          description: 'Create a new note in the Obsidian vault. Safe by default: existing files are rejected unless overwrite=true is passed intentionally.',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Path where the note should be created',
              },
              content: {
                type: 'string',
                description: 'Content of the note',
              },
              overwrite: {
                type: 'boolean',
                description: 'Safety flag. Defaults to false; pass true intentionally to replace an existing note.',
                default: false,
              },
              dryRun: {
                type: 'boolean',
                description: 'Preview create/overwrite without writing. Overwrite previews include a diff.',
                default: false,
              },
              expectedHash: {
                type: 'string',
                description: 'Optional SHA-256 guard for overwrites; write is refused if current content differs.',
              },
              expectedMtime: {
                description: 'Optional mtime guard for overwrites; ISO string or millisecond timestamp.',
              },
            },
            required: ['path', 'content'],
          },
        },
        {
          name: 'search_vault',
          description: 'Search the vault with pagination, filtering, and sorting controls for large vault workflows.',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Required search term. Example: "complexity".',
              },
              limit: {
                type: 'number',
                minimum: 1,
                maximum: 500,
                default: 50,
                description: 'Maximum number of results to return per call (1-500, default: 50).',
              },
              offset: {
                type: 'number',
                minimum: 0,
                default: 0,
                description: 'Zero-based index of the first result to return (default: 0).',
              },
              pathPrefix: {
                type: 'string',
                description: 'Optional vault-relative path prefix to scope results, e.g. "PhD/Thesis".',
              },
              extensions: {
                type: 'array',
                description: 'Optional file extension filter. Use values with or without dot, e.g. [".md", "pdf"].',
                items: {
                  type: 'string'
                },
              },
              matchType: {
                type: 'string',
                enum: ['filename', 'content', 'both'],
                default: 'both',
                description: 'Match source selector: filename only, content only, or both (default: both).',
              },
              sortBy: {
                type: 'string',
                enum: ['score', 'path'],
                default: 'score',
                description: 'Sort key (default: score).',
              },
              sortDirection: {
                type: 'string',
                enum: ['asc', 'desc'],
                default: 'desc',
                description: 'Sort direction (default: desc).',
              },
            },
            required: ['query'],
          },
        },
        {
          name: 'move_note',
          description: 'Move or rename a note to a new location in the Obsidian vault. Does not update inbound links yet; use with care.',
          inputSchema: {
            type: 'object',
            properties: {
              sourcePath: {
                type: 'string',
                description: 'Current path to the note within the vault',
              },
              destinationPath: {
                type: 'string',
                description: 'New path where the note should be moved',
              },
            },
            required: ['sourcePath', 'destinationPath'],
          },
        },
        {
          name: 'manage_folder',
          description: 'Create, rename, move, or delete a folder in the Obsidian vault. Destructive for delete/rename/move: verify paths before calling.',
          inputSchema: {
            type: 'object',
            properties: {
              operation: {
                type: 'string',
                description: 'The operation to perform: create, rename, move, or delete',
                enum: ['create', 'rename', 'move', 'delete']
              },
              path: {
                type: 'string',
                description: 'Path to the folder within the vault'
              },
              newPath: {
                type: 'string',
                description: 'New path for the folder (required for rename and move operations)'
              }
            },
            required: ['operation', 'path'],
          },
        },
        {
          name: 'update_note',
          description: 'Update content in an existing note using guarded replacements, line-range replacement, or precise insertions. Prefer Markdown helper tools for wikilinks, embeds, callouts, tasks, and properties.',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Path to the note within the vault'
              },
              edits: {
                type: 'array',
                description: 'Array of edit operations to apply',
                items: {
                  type: 'object',
                  properties: {
                    // 替换模式 (向后兼容)
                    oldText: {
                      type: 'string',
                      description: 'Text to search for and replace (for replace mode)'
                    },
                    newText: {
                      type: 'string',
                      description: 'Text to replace with (for replace mode)'
                    },
                    expectedCount: {
                      type: 'number',
                      description: 'Expected number of matches for replace mode (default: 1). Refuses ambiguous edits.'
                    },
                    
                    // 插入模式
                    mode: {
                      type: 'string',
                      enum: ['replace', 'insert', 'replaceRange'],
                      description: 'Edit mode: replace (default), insert, or replaceRange',
                      default: 'replace'
                    },
                    heading: {
                      type: 'string',
                      description: 'Target heading for insert mode'
                    },
                    content: {
                      type: 'string',
                      description: 'Content to insert (for insert mode)'
                    },
                    position: {
                      type: 'string',
                      enum: ['before', 'after', 'append', 'prepend'],
                      description: 'Where to insert relative to heading: before (above heading), after (below heading), append (end of section), prepend (start of section)',
                      default: 'after'
                    },
                    level: {
                      type: 'number',
                      minimum: 1,
                      maximum: 6,
                      description: 'Heading level (1-6) for more precise targeting'
                    },
                    blockId: {
                      type: 'string',
                      description: 'Block ID for block-based insertion (^block-id)'
                    },
                    startLine: {
                      type: 'number',
                      description: '1-based inclusive start line for replaceRange mode'
                    },
                    endLine: {
                      type: 'number',
                      description: '1-based inclusive end line for replaceRange mode'
                    },
                    newContent: {
                      type: 'string',
                      description: 'Replacement content for replaceRange mode'
                    }
                  },
                  anyOf: [
                    { required: ['oldText', 'newText'] },     // 替换模式
                    { required: ['mode', 'heading', 'content'] }, // 标题插入
                    { required: ['mode', 'blockId', 'content'] }   // 块插入
                  ]
                }
              },
              dryRun: {
                type: 'boolean',
                description: 'Preview changes without applying them',
                default: false
              },
              expectedHash: {
                type: 'string',
                description: 'Optional SHA-256 guard; update is refused if current content differs.'
              },
              expectedMtime: {
                description: 'Optional mtime guard; ISO string or millisecond timestamp.'
              }
            },
            required: ['path', 'edits'],
          },
        },
        {
          name: 'get_note_metadata',
          description: 'Read lightweight note metadata without asking the agent to parse the whole note manually: frontmatter, file state, headings, links, embeds, tags, block IDs, and word count.',
          inputSchema: {
            type: 'object',
            properties: { path: { type: 'string', description: 'Path to the note within the vault' } },
            required: ['path'],
          },
        },
        {
          name: 'get_properties',
          description: 'Read Obsidian YAML frontmatter/properties for a note. Prefer this over read_note when only metadata is needed.',
          inputSchema: {
            type: 'object',
            properties: { path: { type: 'string', description: 'Path to the note within the vault' } },
            required: ['path'],
          },
        },
        {
          name: 'set_properties',
          description: 'Safely set Obsidian YAML frontmatter/properties. Prefer this over update_note for tags, aliases, status, dates, and other metadata.',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Path to the note within the vault' },
              properties: { type: 'object', description: 'Properties to merge or replace' },
              mode: { type: 'string', enum: ['merge', 'replace'], default: 'merge', description: 'merge updates named keys; replace rewrites all frontmatter properties' },
              dryRun: { type: 'boolean', default: false, description: 'Preview diff without writing' },
              expectedHash: { type: 'string', description: 'Optional SHA-256 write guard' },
              expectedMtime: { description: 'Optional mtime write guard; ISO string or millisecond timestamp' },
            },
            required: ['path', 'properties'],
          },
        },
        {
          name: 'remove_properties',
          description: 'Safely remove keys from Obsidian YAML frontmatter/properties with optional dry-run and write guards.',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Path to the note within the vault' },
              keys: { type: 'array', items: { type: 'string' }, description: 'Property keys to remove' },
              dryRun: { type: 'boolean', default: false, description: 'Preview diff without writing' },
              expectedHash: { type: 'string', description: 'Optional SHA-256 write guard' },
              expectedMtime: { description: 'Optional mtime write guard; ISO string or millisecond timestamp' },
            },
            required: ['path', 'keys'],
          },
        },
        {
          name: 'format_wikilink',
          description: 'Format an Obsidian-native wikilink or embed. Use for vault-internal links instead of Markdown links.',
          inputSchema: {
            type: 'object',
            properties: {
              target: { type: 'string', description: 'Target note or file' },
              alias: { type: 'string', description: 'Optional display text' },
              heading: { type: 'string', description: 'Optional heading subpath' },
              blockId: { type: 'string', description: 'Optional block ID without #^' },
              embed: { type: 'boolean', default: false, description: 'Prefix with ! to create an embed' },
            },
            required: ['target'],
          },
        },
        {
          name: 'insert_wikilink',
          description: 'Insert an Obsidian wikilink into a note. Prefer this over raw update_note for internal links.',
          inputSchema: { type: 'object', properties: { path: { type: 'string' }, target: { type: 'string' }, alias: { type: 'string' }, heading: { type: 'string' }, blockId: { type: 'string' }, position: { type: 'string', enum: ['before', 'after', 'append', 'prepend'], default: 'append' }, dryRun: { type: 'boolean', default: false }, expectedHash: { type: 'string' }, expectedMtime: {} }, required: ['path', 'target'] },
        },
        {
          name: 'insert_embed',
          description: 'Insert an Obsidian embed for notes, images, PDFs, audio, or other vault files.',
          inputSchema: { type: 'object', properties: { path: { type: 'string' }, target: { type: 'string' }, width: { type: 'number' }, height: { type: 'number' }, subpath: { type: 'string' }, heading: { type: 'string' }, blockId: { type: 'string' }, position: { type: 'string', enum: ['before', 'after', 'append', 'prepend'], default: 'append' }, dryRun: { type: 'boolean', default: false }, expectedHash: { type: 'string' }, expectedMtime: {} }, required: ['path', 'target'] },
        },
        {
          name: 'insert_callout',
          description: 'Insert an Obsidian callout block. Prefer this over hand-formatting callout Markdown.',
          inputSchema: { type: 'object', properties: { path: { type: 'string' }, type: { type: 'string' }, title: { type: 'string' }, fold: { type: 'string', enum: ['expanded', 'collapsed', 'none'], default: 'none' }, content: { type: 'string' }, heading: { type: 'string' }, blockId: { type: 'string' }, position: { type: 'string', enum: ['before', 'after', 'append', 'prepend'], default: 'append' }, dryRun: { type: 'boolean', default: false }, expectedHash: { type: 'string' }, expectedMtime: {} }, required: ['path', 'type', 'content'] },
        },
        {
          name: 'append_task',
          description: 'Append an Obsidian task list item, optionally under a heading. Prefer this over raw text edits for tasks.',
          inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' }, heading: { type: 'string' }, checked: { type: 'boolean', default: false }, dryRun: { type: 'boolean', default: false }, expectedHash: { type: 'string' }, expectedMtime: {} }, required: ['path', 'content'] },
        },
        {
          name: 'toggle_task',
          description: 'Toggle an existing Obsidian task by line number or unique text match.',
          inputSchema: { type: 'object', properties: { path: { type: 'string' }, lineNumber: { type: 'number' }, textMatch: { type: 'string' }, checked: { type: 'boolean' }, dryRun: { type: 'boolean', default: false }, expectedHash: { type: 'string' }, expectedMtime: {} }, required: ['path', 'checked'] },
        },
        {
          name: 'get_base',
          description: 'Parse a .base file into structured JSON so agents can inspect filters, formulas, views, and displayed columns.',
          inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Path to a .base file' } }, required: ['path'] },
        },
        {
          name: 'validate_base',
          description: 'Validate Obsidian Bases YAML structure. Checks schema shape, views, filters, formula references, summaries, and MCP query support warnings.',
          inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Path to a .base file' }, content: { type: 'string', description: 'Raw .base YAML content instead of path' } } },
        },
        {
          name: 'create_base',
          description: 'Create a valid Obsidian .base file. Safe by default: rejects existing files unless overwrite=true.',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              filters: { description: 'Global Base filters: string or and/or/not object' },
              formulas: { type: 'object' },
              properties: { type: 'object' },
              summaries: { type: 'object' },
              views: { type: 'array', items: { type: 'object' } },
              overwrite: { type: 'boolean', default: false },
              dryRun: { type: 'boolean', default: false },
              expectedHash: { type: 'string' },
              expectedMtime: {},
            },
            required: ['path', 'views'],
          },
        },
        {
          name: 'add_base_view',
          description: 'Add a view to an existing .base file, validating before writing.',
          inputSchema: { type: 'object', properties: { path: { type: 'string' }, view: { type: 'object' }, dryRun: { type: 'boolean', default: false }, expectedHash: { type: 'string' }, expectedMtime: {} }, required: ['path', 'view'] },
        },
        {
          name: 'update_base_view',
          description: 'Patch a named view in an existing .base file, validating before writing.',
          inputSchema: { type: 'object', properties: { path: { type: 'string' }, viewName: { type: 'string' }, patch: { type: 'object' }, dryRun: { type: 'boolean', default: false }, expectedHash: { type: 'string' }, expectedMtime: {} }, required: ['path', 'viewName', 'patch'] },
        },
        {
          name: 'set_base_filters',
          description: 'Set global filters or filters for a named view in a .base file.',
          inputSchema: { type: 'object', properties: { path: { type: 'string' }, filters: {}, scope: { type: 'string', enum: ['global', 'view'], default: 'global' }, viewName: { type: 'string' }, dryRun: { type: 'boolean', default: false }, expectedHash: { type: 'string' }, expectedMtime: {} }, required: ['path', 'filters'] },
        },
        {
          name: 'set_base_formula',
          description: 'Set or replace a formula property in a .base file. Formula expressions are stored as strings and validated for obvious reference issues.',
          inputSchema: { type: 'object', properties: { path: { type: 'string' }, name: { type: 'string' }, expression: { type: 'string' }, dryRun: { type: 'boolean', default: false }, expectedHash: { type: 'string' }, expectedMtime: {} }, required: ['path', 'name', 'expression'] },
        },
        {
          name: 'insert_base_embed',
          description: 'Insert an Obsidian base embed like ![[File.base]] or ![[File.base#View]] into a Markdown note.',
          inputSchema: { type: 'object', properties: { path: { type: 'string' }, basePath: { type: 'string' }, viewName: { type: 'string' }, heading: { type: 'string' }, blockId: { type: 'string' }, position: { type: 'string', enum: ['before', 'after', 'append', 'prepend'], default: 'append' }, dryRun: { type: 'boolean', default: false }, expectedHash: { type: 'string' }, expectedMtime: {} }, required: ['path', 'basePath'] },
        },
        {
          name: 'query_base',
          description: 'Evaluate a practical MCP-supported subset of a .base view for automation: folder/ext/name/path/property filters, regex matches, simple file metadata, and simple formulas. Unsupported expressions are returned as warnings.',
          inputSchema: { type: 'object', properties: { path: { type: 'string' }, viewName: { type: 'string' }, limit: { type: 'number', default: 100 }, sortBy: { type: 'string' }, sortDirection: { type: 'string', enum: ['asc', 'desc'], default: 'asc' } }, required: ['path'] },
        },
        {
          name: 'read_multiple_notes',
          description: 'Read content from multiple notes simultaneously',
          inputSchema: {
            type: 'object',
            properties: {
              paths: {
                type: 'array',
                description: 'Array of note paths to read',
                items: {
                  type: 'string'
                }
              }
            },
            required: ['paths'],
          },
        },
        {
          name: 'auto_backlink_vault',
          description: 'Automatically add backlinks throughout the entire vault by detecting note names in content and converting them to wikilinks',
          inputSchema: {
            type: 'object',
            properties: {
              dryRun: {
                type: 'boolean',
                description: 'Preview changes without applying them (default: true)',
                default: true
              },
              excludePatterns: {
                type: 'array',
                description: 'Array of glob patterns to exclude from processing (e.g., ["template/*", "archive/*"])',
                items: {
                  type: 'string'
                },
                default: []
              },
              minLength: {
                type: 'number',
                description: 'Minimum note name length to consider for linking (default: 3)',
                default: 3
              },
              caseSensitive: {
                type: 'boolean',
                description: 'Whether matching should be case sensitive (default: false)',
                default: false
              },
              wholeWords: {
                type: 'boolean',
                description: 'Whether to match only whole words (default: true)',
                default: true
              },
              batchSize: {
                type: 'number',
                description: 'Number of notes to process in each batch (default: 50)',
                default: 50
              }
            },
            required: [],
          },
        },
        {
          name: 'notes_insight',
          description: 'Generate insights about a topic using TRILEMMA-PRINCIPLES framework with AI-powered summarization',
          inputSchema: {
            type: 'object',
            properties: {
              topic: {
                type: 'string',
                description: 'Topic keyword or phrase to analyze'
              },
              maxNotes: {
                type: 'number',
                description: 'Maximum number of notes to analyze (default: 5)',
                default: 5
              },
              maxContextLength: {
                type: 'number',
                description: 'Maximum context length in characters (default: 50000)',
                default: 50000
              },
              enableSummary: {
                type: 'boolean',
                description: 'Whether to enable AI summarization for long notes (default: true)',
                default: true
              }
            },
            required: ['topic'],
          },
        },
      ],
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        switch (request.params.name) {
          case 'list_notes':
            return await this.handleListNotes(request.params.arguments);
          case 'read_note':
            return await this.handleReadNote(request.params.arguments);
          case 'create_note':
            return await this.handleCreateNote(request.params.arguments);
          case 'search_vault':
            return await this.handleSearchVault(request.params.arguments);
          case 'delete_note':
            return await this.handleDeleteNote(request.params.arguments);
          case 'move_note':
            return await this.handleMoveNote(request.params.arguments);
          case 'manage_folder':
            return await this.handleManageFolder(request.params.arguments);
          case 'update_note':
            return await this.handleUpdateNote(request.params.arguments);
          case 'get_note_metadata':
            return await this.handleGetNoteMetadata(request.params.arguments);
          case 'get_properties':
            return await this.handleGetProperties(request.params.arguments);
          case 'set_properties':
            return await this.handleSetProperties(request.params.arguments);
          case 'remove_properties':
            return await this.handleRemoveProperties(request.params.arguments);
          case 'format_wikilink':
            return await this.handleFormatWikilink(request.params.arguments);
          case 'insert_wikilink':
            return await this.handleInsertWikilink(request.params.arguments);
          case 'insert_embed':
            return await this.handleInsertEmbed(request.params.arguments);
          case 'insert_callout':
            return await this.handleInsertCallout(request.params.arguments);
          case 'append_task':
            return await this.handleAppendTask(request.params.arguments);
          case 'toggle_task':
            return await this.handleToggleTask(request.params.arguments);
          case 'get_base':
            return await this.handleGetBase(request.params.arguments);
          case 'validate_base':
            return await this.handleValidateBase(request.params.arguments);
          case 'create_base':
            return await this.handleCreateBase(request.params.arguments);
          case 'add_base_view':
            return await this.handleAddBaseView(request.params.arguments);
          case 'update_base_view':
            return await this.handleUpdateBaseView(request.params.arguments);
          case 'set_base_filters':
            return await this.handleSetBaseFilters(request.params.arguments);
          case 'set_base_formula':
            return await this.handleSetBaseFormula(request.params.arguments);
          case 'insert_base_embed':
            return await this.handleInsertBaseEmbed(request.params.arguments);
          case 'query_base':
            return await this.handleQueryBase(request.params.arguments);
          case 'read_multiple_notes':
            return await this.handleReadMultipleNotes(request.params.arguments);
          case 'auto_backlink_vault':
            return await this.handleAutoBacklinkVault(request.params.arguments);
          case 'notes_insight':
            return await this.handleNotesInsight(request.params.arguments);
          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${request.params.name}`
            );
        }
      } catch (error) {
        console.error(`Error executing tool ${request.params.name}:`, error);
        throw new McpError(
          ErrorCode.InternalError,
          `${error instanceof Error ? error.message : String(error)}`
        );
      }
    });
  }

  // Tool handler implementations
  private async handleListNotes(args: any) {
    const folder = args?.folder || '';
    const recursive = args?.recursive !== undefined ? args.recursive : true;
    if (!folder && recursive) {
      console.error('[INFO] list_notes called with vault-wide recursive scope; consider search_vault or a scoped folder for lower-context discovery.');
    }
    const files = await this.listVaultFiles(folder, recursive);
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(files, null, 2),
        },
      ],
    };
  }

  private async handleReadNote(args: any) {
    if (!args?.path) {
      throw new Error('Path is required');
    }
    
    const content = await this.readNote(args.path);
    
    return {
      content: [
        {
          type: 'text',
          text: content,
        },
      ],
    };
  }

  private async handleCreateNote(args: any) {
    if (!args?.path || !args?.content) {
      throw new Error('Path and content are required');
    }
    
    const result = await this.createNote(args.path, args.content, {
      overwrite: args.overwrite === true,
      dryRun: args.dryRun === true,
      expectedHash: args.expectedHash,
      expectedMtime: args.expectedMtime,
    });
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }


  private async handleSearchVault(args: any) {
    if (!args?.query) {
      throw new Error('Search query is required');
    }

    const options = this.parseSearchOptions(args);
    const allResults = await this.searchVault(args.query);
    const controlledResults = this.applySearchControls(allResults, args.query, options);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(controlledResults, null, 2),
        },
      ],
    };
  }

  private parseSearchOptions(args: any): SearchVaultOptions {
    const limit = args?.limit !== undefined ? Number(args.limit) : 50;
    const offset = args?.offset !== undefined ? Number(args.offset) : 0;
    const pathPrefix = typeof args?.pathPrefix === 'string' && args.pathPrefix.trim().length > 0
      ? normalizeVaultPath(args.pathPrefix.trim())
      : undefined;
    const rawExtensions = args?.extensions;
    const matchType = (args?.matchType || 'both') as SearchMatchType;
    const sortBy = (args?.sortBy || 'score') as SearchSortBy;
    const sortDirection = (args?.sortDirection || 'desc') as SortDirection;

    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new Error('limit must be an integer between 1 and 500');
    }

    if (!Number.isInteger(offset) || offset < 0) {
      throw new Error('offset must be a non-negative integer');
    }

    if (!['filename', 'content', 'both'].includes(matchType)) {
      throw new Error('matchType must be one of: filename, content, both');
    }

    if (!['score', 'path'].includes(sortBy)) {
      throw new Error('sortBy must be one of: score, path');
    }

    if (!['asc', 'desc'].includes(sortDirection)) {
      throw new Error('sortDirection must be one of: asc, desc');
    }

    let extensions: string[] | undefined;
    if (rawExtensions !== undefined) {
      if (!Array.isArray(rawExtensions) || rawExtensions.some((ext) => typeof ext !== 'string' || !ext.trim())) {
        throw new Error('extensions must be an array of non-empty strings');
      }
      extensions = rawExtensions.map((ext) => this.normalizeExtension(ext));
    }

    return {
      limit,
      offset,
      pathPrefix,
      extensions,
      matchType,
      sortBy,
      sortDirection,
    };
  }

  private normalizeExtension(extension: string): string {
    const normalized = extension.trim().toLowerCase();
    return normalized.startsWith('.') ? normalized : `.${normalized}`;
  }

  private extractResultPath(result: any): string {
    return normalizeVaultPath(String(result?.path || result?.filename || ''));
  }

  private classifyResultMatchTypes(result: any, query: string): { filename: boolean; content: boolean } {
    const pathValue = this.extractResultPath(result);
    const lowerQuery = query.toLowerCase();
    let filenameMatch = pathValue.toLowerCase().includes(lowerQuery);
    let contentMatch = false;

    if (Array.isArray(result?.matches)) {
      for (const match of result.matches) {
        if (match?.type === 'filename') {
          filenameMatch = true;
        }
        if (match?.type === 'content') {
          contentMatch = true;
        }
      }
    }

    return {
      filename: filenameMatch,
      content: contentMatch,
    };
  }

  private applySearchControls(results: any[], query: string, options: SearchVaultOptions) {
    const filtered = results.filter((result) => {
      const resultPath = this.extractResultPath(result);
      if (!resultPath) {
        return false;
      }

      if (options.pathPrefix) {
        const normalizedPrefix = options.pathPrefix.toLowerCase();
        const lowerPath = resultPath.toLowerCase();
        const pathStartsWithPrefix = lowerPath === normalizedPrefix || lowerPath.startsWith(`${normalizedPrefix}/`);
        if (!pathStartsWithPrefix) {
          return false;
        }
      }

      if (options.extensions && options.extensions.length > 0) {
        const resultExtension = path.extname(resultPath).toLowerCase();
        if (!options.extensions.includes(resultExtension)) {
          return false;
        }
      }

      const matchTypes = this.classifyResultMatchTypes(result, query);
      if (options.matchType === 'filename' && !matchTypes.filename) {
        return false;
      }
      if (options.matchType === 'content' && !matchTypes.content) {
        return false;
      }

      return true;
    });

    const sorted = [...filtered].sort((a, b) => {
      if (options.sortBy === 'path') {
        const pathA = this.extractResultPath(a);
        const pathB = this.extractResultPath(b);
        const pathCmp = pathA.localeCompare(pathB, undefined, { sensitivity: 'base' });
        return options.sortDirection === 'asc' ? pathCmp : -pathCmp;
      }

      const scoreA = Number(a?.score ?? 0);
      const scoreB = Number(b?.score ?? 0);
      const scoreCmp = scoreA - scoreB;
      if (scoreCmp !== 0) {
        return options.sortDirection === 'asc' ? scoreCmp : -scoreCmp;
      }

      const pathA = this.extractResultPath(a);
      const pathB = this.extractResultPath(b);
      return pathA.localeCompare(pathB, undefined, { sensitivity: 'base' });
    });

    const pagedResults = sorted.slice(options.offset, options.offset + options.limit);
    const total = sorted.length;

    return {
      query,
      total,
      returned: pagedResults.length,
      offset: options.offset,
      limit: options.limit,
      hasMore: options.offset + pagedResults.length < total,
      filters: {
        pathPrefix: options.pathPrefix || null,
        extensions: options.extensions || null,
        matchType: options.matchType,
        sortBy: options.sortBy,
        sortDirection: options.sortDirection,
      },
      results: pagedResults,
    };
  }

  private async handleDeleteNote(args: any) {
    if (!args?.path) {
      throw new Error('Path is required');
    }
    
    await this.deleteNote(args.path);
    
    return {
      content: [
        {
          type: 'text',
          text: `Note deleted successfully: ${args.path}`,
        },
      ],
    };
  }

  private async handleMoveNote(args: any) {
    if (!args?.sourcePath || !args?.destinationPath) {
      throw new Error('Source path and destination path are required');
    }
    
    await this.moveNote(args.sourcePath, args.destinationPath);
    
    return {
      content: [
        {
          type: 'text',
          text: `Note moved successfully from ${args.sourcePath} to ${args.destinationPath}`,
        },
      ],
    };
  }

  // Tool handler for folder operations
  private async handleManageFolder(args: any) {
    if (!args?.operation || !args?.path) {
      throw new Error('Operation and path are required');
    }
    
    const operation = args.operation;
    const folderPath = args.path;
    const newPath = args.newPath;
    
    // Check if the target folder is excluded (except for create, where we might be creating it?)
    // Actually, we shouldn't create excluded folders either.
    if (isExcluded(folderPath)) {
      throw new Error(`Folder is excluded or not found: ${folderPath}`);
    }

    if (newPath && isExcluded(newPath)) {
      throw new Error(`Cannot move/rename to excluded path: ${newPath}`);
    }

    switch (operation) {
      case 'create':
        await this.createFolder(folderPath);
        return {
          content: [
            {
              type: 'text',
              text: `Folder created successfully at ${folderPath}`,
            },
          ],
        };
      
      case 'rename':
        if (!newPath) {
          throw new Error('New path is required for rename operation');
        }
        await this.renameFolder(folderPath, newPath);
        return {
          content: [
            {
              type: 'text',
              text: `Folder renamed from ${folderPath} to ${newPath}`,
            },
          ],
        };
      
      case 'move':
        if (!newPath) {
          throw new Error('New path is required for move operation');
        }
        await this.moveFolder(folderPath, newPath);
        return {
          content: [
            {
              type: 'text',
              text: `Folder moved from ${folderPath} to ${newPath}`,
            },
          ],
        };
      
      case 'delete':
        await this.deleteFolder(folderPath);
        return {
          content: [
            {
              type: 'text',
              text: `Folder deleted successfully: ${folderPath}`,
            },
          ],
        };
      
      default:
        throw new Error(`Unknown folder operation: ${operation}`);
    }
  }

  // Handler for update_note tool
  private async handleUpdateNote(args: any) {
    if (!args?.path || !args?.edits) {
      throw new Error('Path and edits are required');
    }
    
    if (isExcluded(args.path)) {
      throw new Error(`Note not found: ${args.path}`);
    }

    if (!Array.isArray(args.edits)) {
      throw new Error('Edits must be an array');
    }
    
    const dryRun = args.dryRun || false;
    const notePath = args.path;
    const edits = args.edits;
    assertExpectedState(notePath, args.expectedHash, args.expectedMtime);
    const structuredResult = await applyNoteEditsV2(notePath, edits, dryRun);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(structuredResult, null, 2),
        },
      ],
    };
    
    // 尝试使用 Obsidian API 进行插入操作，如果失败则回退到文件系统
    let apiResults: string[] = [];
    let fallbackEdits: EditOperation[] = [];
    
    for (const edit of edits) {
      const mode = edit.mode || 'replace';
      
      if (mode === 'insert' && !dryRun) {
        try {
          // 尝试使用 Obsidian API
          if (edit.heading) {
            await this.patchNoteViaAPI(notePath, edit.heading, edit.content || '', edit.position || 'after');
            apiResults.push(`API: Inserted content ${edit.position || 'after'} heading "${edit.heading}"`);
          } else if (edit.blockId) {
            await this.patchNoteViaBlockAPI(notePath, edit.blockId, edit.content || '', edit.position || 'after');
            apiResults.push(`API: Inserted content ${edit.position || 'after'} block "${edit.blockId}"`);
          } else {
            // 无效的插入操作，添加到回退列表
            fallbackEdits.push(edit);
          }
        } catch (error) {
          // API 失败，添加到回退列表
          console.warn(`API PATCH failed for edit, falling back to filesystem: ${error}`);
          fallbackEdits.push(edit);
        }
      } else {
        // 替换模式或干运行，添加到回退列表
        fallbackEdits.push(edit);
      }
    }
    
    // 如果有回退操作，使用文件系统方法
    let filesystemResult = '';
    if (fallbackEdits.length > 0) {
      filesystemResult = await applyNoteEdits(notePath, fallbackEdits, dryRun);
    }
    
    // 合并结果
    let result = '';
    if (apiResults.length > 0) {
      result += 'Obsidian API operations:\n' + apiResults.join('\n') + '\n\n';
    }
    if (filesystemResult) {
      result += fallbackEdits.length === edits.length ? filesystemResult : 
                `Filesystem operations:\n${filesystemResult}`;
    }
    if (!result) {
      result = `File ${notePath} updated successfully`;
    }
    
    return {
      content: [
        {
          type: 'text',
          text: result,
        },
      ],
    };
  }

  private async handleGetNoteMetadata(args: any) {
    if (!args?.path) {
      throw new Error('Path is required');
    }
    const content = readTextFile(args.path);
    const state = getFileState(args.path);
    const metadata = extractMarkdownMetadata(content);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ path: args.path, state, ...metadata }, null, 2),
        },
      ],
    };
  }

  private async handleGetProperties(args: any) {
    if (!args?.path) {
      throw new Error('Path is required');
    }
    const parsed = parseFrontmatter(readTextFile(args.path));
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ path: args.path, properties: parsed.properties, hasFrontmatter: parsed.hasFrontmatter }, null, 2),
        },
      ],
    };
  }

  private async handleSetProperties(args: any) {
    if (!args?.path || !args?.properties || typeof args.properties !== 'object' || Array.isArray(args.properties)) {
      throw new Error('Path and properties object are required');
    }
    const dryRun = args.dryRun === true;
    assertExpectedState(args.path, args.expectedHash, args.expectedMtime);
    const original = readTextFile(args.path);
    const parsed = parseFrontmatter(original);
    const mode = args.mode || 'merge';
    if (!['merge', 'replace'].includes(mode)) {
      throw new Error('mode must be merge or replace');
    }
    const properties = mode === 'replace' ? args.properties : { ...parsed.properties, ...args.properties };
    const updated = serializeFrontmatter(properties, parsed.body);
    const changed = normalizeLineEndings(original) !== normalizeLineEndings(updated);
    const result = {
      path: args.path,
      dryRun,
      changed,
      mode,
      properties,
      diff: changed ? createUnifiedDiff(original, updated, args.path) : undefined,
    };
    if (!dryRun && changed) {
      writeTextFileAtomic(args.path, updated);
    }
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }

  private async handleRemoveProperties(args: any) {
    if (!args?.path || !Array.isArray(args.keys)) {
      throw new Error('Path and keys array are required');
    }
    const dryRun = args.dryRun === true;
    assertExpectedState(args.path, args.expectedHash, args.expectedMtime);
    const original = readTextFile(args.path);
    const parsed = parseFrontmatter(original);
    const properties = { ...parsed.properties };
    for (const key of args.keys) {
      delete properties[key];
    }
    const updated = serializeFrontmatter(properties, parsed.body);
    const changed = normalizeLineEndings(original) !== normalizeLineEndings(updated);
    const result = {
      path: args.path,
      dryRun,
      changed,
      removedKeys: args.keys,
      properties,
      diff: changed ? createUnifiedDiff(original, updated, args.path) : undefined,
    };
    if (!dryRun && changed) {
      writeTextFileAtomic(args.path, updated);
    }
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }

  private async handleFormatWikilink(args: any) {
    if (!args?.target) {
      throw new Error('target is required');
    }
    const text = formatWikilink(args.target, args.alias, args.heading, args.blockId, args.embed === true);
    return { content: [{ type: 'text', text }] };
  }

  private async insertMarkdownSnippet(args: any, snippet: string) {
    if (!args?.path) {
      throw new Error('Path is required');
    }
    const dryRun = args.dryRun === true;
    assertExpectedState(args.path, args.expectedHash, args.expectedMtime);
    const edit: EditOperation = {
      mode: 'insert',
      content: `${snippet}\n`,
      heading: args.heading,
      blockId: args.blockId,
      position: args.position || 'append',
    };
    const result = await applyNoteEditsV2(args.path, [edit], dryRun);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }

  private async handleInsertWikilink(args: any) {
    if (!args?.target) {
      throw new Error('target is required');
    }
    return this.insertMarkdownSnippet(args, formatWikilink(args.target, args.alias, undefined, undefined, false));
  }

  private async handleInsertEmbed(args: any) {
    if (!args?.target) {
      throw new Error('target is required');
    }
    let target = args.target;
    if (args.subpath) {
      target += args.subpath.startsWith('#') ? args.subpath : `#${args.subpath}`;
    }
    const size = args.width && args.height ? `${args.width}x${args.height}` : args.width ? String(args.width) : '';
    const snippet = `![[${target}${size ? `|${size}` : ''}]]`;
    return this.insertMarkdownSnippet(args, snippet);
  }

  private async handleInsertCallout(args: any) {
    if (!args?.type || args.content === undefined) {
      throw new Error('type and content are required');
    }
    return this.insertMarkdownSnippet(args, buildCallout(args.type, args.content, args.title, args.fold || 'none'));
  }

  private async handleAppendTask(args: any) {
    if (!args?.content) {
      throw new Error('content is required');
    }
    const marker = args.checked === true ? 'x' : ' ';
    return this.insertMarkdownSnippet({ ...args, position: args.position || 'append' }, `- [${marker}] ${args.content}`);
  }

  private async handleToggleTask(args: any) {
    if (!args?.path || typeof args.checked !== 'boolean') {
      throw new Error('path and checked are required');
    }
    const content = readTextFile(args.path);
    const lines = normalizeLineEndings(content).split('\n');
    let targetIndex = -1;
    if (args.lineNumber !== undefined) {
      targetIndex = Number(args.lineNumber) - 1;
    } else if (args.textMatch) {
      targetIndex = lines.findIndex((line) => line.includes(args.textMatch) && /^\s*[-*+]\s+\[[ xX]\]/.test(line));
    } else {
      throw new Error('lineNumber or textMatch is required');
    }
    if (targetIndex < 0 || targetIndex >= lines.length || !/^\s*[-*+]\s+\[[ xX]\]/.test(lines[targetIndex])) {
      throw new Error('Target line is not a task');
    }
    const updatedLine = lines[targetIndex].replace(/\[[ xX]\]/, args.checked ? '[x]' : '[ ]');
    return this.handleUpdateNote({
      path: args.path,
      dryRun: args.dryRun,
      expectedHash: args.expectedHash,
      expectedMtime: args.expectedMtime,
      edits: [{ mode: 'replaceRange', startLine: targetIndex + 1, endLine: targetIndex + 1, newContent: updatedLine }],
    });
  }

  private readBase(pathValue: string): BaseDocument {
    return parseBaseContent(readTextFile(pathValue));
  }

  private baseMutationResult(pathValue: string, original: string, updated: string, dryRun: boolean, validation: ReturnType<typeof validateBaseDocument>) {
    const changed = normalizeLineEndings(original) !== normalizeLineEndings(updated);
    const result = {
      path: pathValue,
      dryRun,
      changed,
      validation,
      diff: changed ? createUnifiedDiff(original, updated, pathValue) : undefined,
    };
    if (!dryRun && changed) {
      writeTextFileAtomic(pathValue, updated);
    }
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }

  private async handleGetBase(args: any) {
    if (!args?.path) {
      throw new Error('path is required');
    }
    const base = this.readBase(args.path);
    const validation = validateBaseDocument(base);
    return { content: [{ type: 'text', text: JSON.stringify({ path: args.path, base, validation }, null, 2) }] };
  }

  private async handleValidateBase(args: any) {
    if (!args?.path && args?.content === undefined) {
      throw new Error('path or content is required');
    }
    const content = args.content !== undefined ? args.content : readTextFile(args.path);
    const base = parseBaseContent(content);
    const validation = validateBaseDocument(base);
    return { content: [{ type: 'text', text: JSON.stringify({ path: args.path || null, ...validation }, null, 2) }] };
  }

  private async handleCreateBase(args: any) {
    if (!args?.path || !Array.isArray(args.views)) {
      throw new Error('path and views array are required');
    }
    const base: BaseDocument = {
      ...(args.filters !== undefined ? { filters: args.filters } : {}),
      ...(args.formulas !== undefined ? { formulas: args.formulas } : {}),
      ...(args.properties !== undefined ? { properties: args.properties } : {}),
      ...(args.summaries !== undefined ? { summaries: args.summaries } : {}),
      views: args.views,
    };
    const validation = validateBaseDocument(base);
    if (!validation.valid) {
      throw new Error(`Invalid base: ${validation.errors.join('; ')}`);
    }
    const result = await this.createNote(args.path, serializeBase(base), {
      overwrite: args.overwrite === true,
      dryRun: args.dryRun === true,
      expectedHash: args.expectedHash,
      expectedMtime: args.expectedMtime,
    });
    return { content: [{ type: 'text', text: JSON.stringify({ ...result, validation }, null, 2) }] };
  }

  private async handleAddBaseView(args: any) {
    if (!args?.path || !args?.view) {
      throw new Error('path and view are required');
    }
    assertExpectedState(args.path, args.expectedHash, args.expectedMtime);
    const original = readTextFile(args.path);
    const base = parseBaseContent(original);
    base.views = [...(base.views || []), args.view];
    const validation = validateBaseDocument(base);
    if (!validation.valid) {
      throw new Error(`Invalid base: ${validation.errors.join('; ')}`);
    }
    return this.baseMutationResult(args.path, original, serializeBase(base), args.dryRun === true, validation);
  }

  private async handleUpdateBaseView(args: any) {
    if (!args?.path || !args?.viewName || !args?.patch) {
      throw new Error('path, viewName, and patch are required');
    }
    assertExpectedState(args.path, args.expectedHash, args.expectedMtime);
    const original = readTextFile(args.path);
    const base = parseBaseContent(original);
    const view = (base.views || []).find((candidate) => candidate.name === args.viewName);
    if (!view) {
      throw new Error(`Base view not found: ${args.viewName}`);
    }
    Object.assign(view, args.patch);
    const validation = validateBaseDocument(base);
    if (!validation.valid) {
      throw new Error(`Invalid base: ${validation.errors.join('; ')}`);
    }
    return this.baseMutationResult(args.path, original, serializeBase(base), args.dryRun === true, validation);
  }

  private async handleSetBaseFilters(args: any) {
    if (!args?.path || args.filters === undefined) {
      throw new Error('path and filters are required');
    }
    assertExpectedState(args.path, args.expectedHash, args.expectedMtime);
    const original = readTextFile(args.path);
    const base = parseBaseContent(original);
    if ((args.scope || 'global') === 'view') {
      if (!args.viewName) {
        throw new Error('viewName is required when scope is view');
      }
      selectBaseView(base, args.viewName).filters = args.filters;
    } else {
      base.filters = args.filters;
    }
    const validation = validateBaseDocument(base);
    if (!validation.valid) {
      throw new Error(`Invalid base: ${validation.errors.join('; ')}`);
    }
    return this.baseMutationResult(args.path, original, serializeBase(base), args.dryRun === true, validation);
  }

  private async handleSetBaseFormula(args: any) {
    if (!args?.path || !args?.name || typeof args.expression !== 'string') {
      throw new Error('path, name, and expression are required');
    }
    assertExpectedState(args.path, args.expectedHash, args.expectedMtime);
    const original = readTextFile(args.path);
    const base = parseBaseContent(original);
    base.formulas = { ...(base.formulas || {}), [args.name]: args.expression };
    const validation = validateBaseDocument(base);
    if (!validation.valid) {
      throw new Error(`Invalid base: ${validation.errors.join('; ')}`);
    }
    return this.baseMutationResult(args.path, original, serializeBase(base), args.dryRun === true, validation);
  }

  private async handleInsertBaseEmbed(args: any) {
    if (!args?.path || !args?.basePath) {
      throw new Error('path and basePath are required');
    }
    const target = args.viewName ? `${args.basePath}#${args.viewName}` : args.basePath;
    return this.insertMarkdownSnippet(args, `![[${target}]]`);
  }

  private async handleQueryBase(args: any) {
    if (!args?.path) {
      throw new Error('path is required');
    }
    const base = this.readBase(args.path);
    const validation = validateBaseDocument(base);
    if (!validation.valid) {
      throw new Error(`Invalid base: ${validation.errors.join('; ')}`);
    }
    const view = selectBaseView(base, args.viewName);
    const warnings = [...validation.warnings];
    const files = await this.listVaultFiles('', true);
    const rows: any[] = [];

    for (const filePath of files) {
      try {
        const state = getFileState(filePath);
        const ext = path.extname(filePath).replace(/^\./, '');
        const fileInfo = {
          name: path.basename(filePath),
          basename: path.basename(filePath, path.extname(filePath)),
          path: normalizeVaultPath(filePath),
          folder: normalizeVaultPath(path.dirname(filePath)).replace(/^\.$/, ''),
          ext,
          size: state.size,
          ctime: state.ctime,
          mtime: state.mtime,
          tags: [] as string[],
        };
        let note: Record<string, any> = {};
        if (ext === 'md') {
          const metadata = extractMarkdownMetadata(readTextFile(filePath));
          note = metadata.properties;
          fileInfo.tags = metadata.tags;
        }
        const rowContext = { file: fileInfo, note, formula: {} as Record<string, any> };
        for (const [name, expression] of Object.entries(base.formulas || {})) {
          rowContext.formula[name] = evaluateSimpleFormula(expression, rowContext, warnings);
        }
        if (!evaluateBaseFilter(base.filters, rowContext, warnings) || !evaluateBaseFilter(view.filters, rowContext, warnings)) {
          continue;
        }
        const output: Record<string, any> = {};
        const columns = view.order && view.order.length > 0 ? view.order : ['file.name', 'file.path'];
        for (const column of columns) {
          output[column] = getBaseValue(rowContext, column);
        }
        rows.push({ path: fileInfo.path, values: output, file: fileInfo, note, formula: rowContext.formula });
      } catch (error) {
        warnings.push(`Skipped ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const sortBy = args.sortBy;
    if (sortBy) {
      rows.sort((a, b) => {
        const left = a.values[sortBy] ?? getBaseValue(a, sortBy);
        const right = b.values[sortBy] ?? getBaseValue(b, sortBy);
        const cmp = String(left ?? '').localeCompare(String(right ?? ''), undefined, { numeric: true, sensitivity: 'base' });
        return args.sortDirection === 'desc' ? -cmp : cmp;
      });
    }
    const limit = args.limit !== undefined ? Number(args.limit) : 100;
    const limitedRows = rows.slice(0, limit);
    const uniqueWarnings = [...new Set(warnings)];
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          path: args.path,
          view: view.name,
          supported: uniqueWarnings.length === 0,
          warnings: uniqueWarnings,
          total: rows.length,
          returned: limitedRows.length,
          rows: limitedRows,
        }, null, 2),
      }],
    };
  }

  // Handler for read_multiple_notes tool
  private async handleReadMultipleNotes(args: any) {
    if (!args?.paths) {
      throw new Error('Paths are required');
    }
    
    if (!Array.isArray(args.paths)) {
      throw new Error('Paths must be an array');
    }
    
    const results = await Promise.all(
      args.paths.map(async (notePath: string) => {
        try {
          const content = await this.readNote(notePath);
          return `${notePath}:\n${content}\n`;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return `${notePath}: Error - ${errorMessage}`;
        }
      })
    );
    
    return {
      content: [
        {
          type: 'text',
          text: results.join('\n---\n'),
        },
      ],
    };
  }

  // Handler for auto_backlink_vault tool
  private async handleAutoBacklinkVault(args: any) {
    // Auto backlink vault processing
    
    // Set default values
    const options = {
      dryRun: args?.dryRun !== undefined ? args.dryRun : true,
      excludePatterns: args?.excludePatterns || [],
      minLength: args?.minLength || 3,
      caseSensitive: args?.caseSensitive || false,
      wholeWords: args?.wholeWords !== undefined ? args.wholeWords : true,
      batchSize: args?.batchSize || 50,
    };
    
    // Process with validated options
    
    // Validate options
    if (!Array.isArray(options.excludePatterns)) {
      throw new Error('excludePatterns must be an array');
    }
    
    if (typeof options.minLength !== 'number' || options.minLength < 1 || options.minLength > 100) {
      throw new Error('minLength must be a positive number between 1 and 100');
    }
    
    if (typeof options.batchSize !== 'number' || options.batchSize < 1 || options.batchSize > 500) {
      throw new Error('batchSize must be a positive number between 1 and 500');
    }
    
    // Safety checks
    if (!options.dryRun) {
      console.warn('[WARNING] Auto backlink vault will modify files. Make sure you have backups!');
    }
    
    // Validate exclude patterns
    for (const pattern of options.excludePatterns) {
      if (typeof pattern !== 'string') {
        throw new Error('All exclude patterns must be strings');
      }
      try {
        new RegExp(pattern.replace(/\*/g, '.*'));
      } catch (error) {
        throw new Error(`Invalid exclude pattern "${pattern}": ${error}`);
      }
    }
    
    // Process the vault
    const results = await processVaultBacklinks(
      () => this.listVaultFiles(),
      (path: string) => this.readNote(path),
      options
    );
    
    // Format the results
    let output = `Auto Backlink Vault Results:\n`;
    output += `================================\n`;
    output += `Total notes: ${results.totalNotes}\n`;
    output += `Processed notes: ${results.processedNotes}\n`;
    output += `Modified notes: ${results.modifiedNotes}\n`;
    output += `Total links added: ${results.totalLinksAdded}\n`;
    
    if (results.errors.length > 0) {
      output += `\nErrors (${results.errors.length}):\n`;
      results.errors.forEach((error, index) => {
        output += `${index + 1}. ${error}\n`;
      });
    }
    
    if (options.dryRun && results.changes.length > 0) {
      output += `\nPreview of changes (first 10):\n`;
      const previewChanges = results.changes.slice(0, 10);
      previewChanges.forEach((change, index) => {
        output += `${index + 1}. ${change.path}: "${change.oldText}" → "${change.newText}"\n`;
      });
      
      if (results.changes.length > 10) {
        output += `... and ${results.changes.length - 10} more changes\n`;
      }
      
      output += `\nNote: This was a dry run. No changes were actually made.\n`;
      output += `To apply these changes, run the tool again with dryRun: false\n`;
    } else if (!options.dryRun && results.modifiedNotes > 0) {
      output += `\nChanges have been applied successfully!\n`;
    }
    
    return {
      content: [
        {
          type: 'text',
          text: output,
        },
      ],
    };
  }

  // Handler for notes_insight tool
  private async handleNotesInsight(args: any) {
    if (!args?.topic) {
      throw new Error('Topic is required');
    }
    
    const topic = args.topic;
    const maxNotes = args.maxNotes || 5;
    const maxContextLength = args.maxContextLength || 50000;
    const enableSummary = args.enableSummary !== undefined ? args.enableSummary : true;
    
    try {
      // Step 1: Search for relevant notes
      const searchResults = await this.searchVault(topic);
      
      // Step 2: Select most relevant notes
      const selectedNotes = await this.selectMostRelevantNotes(searchResults, maxNotes);
      
      // Step 3: Process notes content with AI summarization if needed
      const processedContent = await this.processNotesContent(
        selectedNotes, 
        maxContextLength, 
        enableSummary
      );
      
      // Step 4: Generate insights using TRILEMMA-PRINCIPLES framework
      const insights = await this.generateInsights(topic, processedContent);
      
      return {
        content: [
          {
            type: 'text',
            text: insights,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to generate insights: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Helper method to select most relevant notes
  private async selectMostRelevantNotes(searchResults: any[], maxNotes: number): Promise<{path: string, score: number, content: string}[]> {
    // Sort by score (descending) and take top results
    const sortedResults = searchResults
      .filter(result => result.path && result.score)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxNotes);
    
    // Read content for selected notes
    const selectedNotes = await Promise.all(
      sortedResults.map(async (result) => {
        try {
          const content = await this.readNote(result.path);
          return {
            path: result.path,
            score: result.score,
            content: content
          };
        } catch (error) {
          console.warn(`Failed to read note ${result.path}:`, error);
          return null;
        }
      })
    );
    
    // Filter out failed reads
    return selectedNotes.filter(note => note !== null) as {path: string, score: number, content: string}[];
  }

  // Helper method to process notes content with AI summarization
  private async processNotesContent(
    notes: {path: string, score: number, content: string}[], 
    maxContextLength: number, 
    enableSummary: boolean
  ): Promise<string> {
    let totalLength = 0;
    let processedNotes: string[] = [];
    
    for (const note of notes) {
      let noteContent = note.content;
      const noteLength = noteContent.length;
      
      // Check if summarization is needed
      if (enableSummary && noteLength > 5000) {
        try {
          noteContent = await this.summarizeNoteContent(note.path, noteContent);
        } catch (error) {
          console.warn(`Failed to summarize note ${note.path}:`, error);
          // Fallback to truncating if AI summarization fails
          noteContent = this.truncateContent(noteContent, 2000);
        }
      }
      
      // Check if adding this note would exceed context length
      if (totalLength + noteContent.length > maxContextLength) {
        // If it's the first note and still too long, truncate it
        if (processedNotes.length === 0) {
          noteContent = this.truncateContent(noteContent, maxContextLength - 1000);
        } else {
          // Skip this note to stay within limits
          break;
        }
      }
      
      processedNotes.push(`## Note: ${note.path}\n\n${noteContent}\n\n---\n`);
      totalLength += noteContent.length;
    }
    
    return processedNotes.join('\n');
  }

  // Helper method to summarize note content using AI
  private async summarizeNoteContent(notePath: string, content: string): Promise<string> {
    // For MCP context, we prepare a structured summary request
    // The calling AI will process this and provide a concise summary
    const summaryRequest = {
      instruction: "Please provide a concise summary of the following note content, focusing on:",
      requirements: [
        "Key concepts and main ideas",
        "Important details and insights", 
        "Relevant facts and data points",
        "Core arguments or conclusions",
        "Actionable information"
      ],
      targetLength: "Aim for 20-30% of original length",
      originalContent: content
    };
    
    // Return structured summary request that the calling AI can process
    return `[SUMMARY REQUEST for ${notePath}]
${summaryRequest.instruction}
${summaryRequest.requirements.map(req => `- ${req}`).join('\n')}
${summaryRequest.targetLength}

Original Content:
${content}

[END SUMMARY REQUEST]`;
  }

  // Helper method to truncate content while preserving structure
  private truncateContent(content: string, maxLength: number): string {
    if (content.length <= maxLength) return content;
    
    const truncated = content.substring(0, maxLength - 50);
    const lastNewline = truncated.lastIndexOf('\n');
    
    if (lastNewline > maxLength * 0.7) {
      return truncated.substring(0, lastNewline) + '\n\n[Content truncated...]';
    }
    
    return truncated + '\n\n[Content truncated...]';
  }

  // Helper method to generate insights using TRILEMMA-PRINCIPLES framework
  private async generateInsights(topic: string, processedContent: string): Promise<string> {
    // Load the TRILEMMA-PRINCIPLES framework from the prepared file
    const trilemmaPrompt = await this.loadTrilemmaPrompt();
    
    // Construct the final prompt for insights generation
    const insightPrompt = `${trilemmaPrompt}

## Analysis Context

**Topic**: ${topic}

**Relevant Notes Content**:
${processedContent}

## Task

Apply the TRILEMMA-PRINCIPLES framework to analyze the topic "${topic}" based on the provided notes content. Focus on identifying constraints, challenging assumptions, and proposing breakthrough solutions.

Please provide your analysis following the framework structure:
1. TRILEMMA IDENTIFICATION
2. FIRST PRINCIPLES QUESTIONING  
3. BREAKTHROUGH SOLUTION
4. SYNTHESIS & RECOMMENDATIONS`;

    return insightPrompt;
  }

  // Helper method to load TRILEMMA-PRINCIPLES prompt
  private async loadTrilemmaPrompt(): Promise<string> {
    // Embedded complete TRILEMMA-PRINCIPLES framework prompt
    return `# TRILEMMA-PRINCIPLES Integrated Analysis Framework

## Your Role
You are an expert strategic analyst capable of identifying structural constraints and breakthrough solutions. Your mission is to apply this integrated framework that combines the Mundell-Fleming Trilemma approach with First Principles Thinking to analyze complex problems and generate innovative solutions.

## Analysis Protocol

### LAYER 1: CONSTRAINT IDENTIFICATION (Trilemma Analysis)

#### Step 1: Extract Core Trilemma Elements
- Identify the three primary objectives/elements in the given scenario
- Map the inherent conflicts between these elements
- Analyze the current system's trade-off choices
- **Output Format**: "The three conflicting elements are: [A], [B], and [C]"

#### Step 2: Constraint Root Analysis
Analyze the fundamental sources of constraints:
- **Technical Constraints**: Current technological limitations
- **Resource Constraints**: Scarcity of time, capital, human resources
- **Institutional Constraints**: Legal, cultural, organizational barriers
- **Physical Constraints**: Natural laws, physical limitations
- **Output Format**: "The primary constraint sources are..."

#### Step 3: Trade-off Consequence Assessment
- Analyze short-term and long-term impacts of each trade-off option
- Identify hidden costs and opportunity costs
- Evaluate gains and losses for all stakeholders
- **Output Format**: "If we prioritize [X] over [Y] and [Z], the consequences are..."

### LAYER 2: ASSUMPTION DECONSTRUCTION (First Principles Analysis)

#### Step 4: Challenge Fundamental Assumptions
Ask critical questions:
- Are the preconditions of this trilemma necessarily true?
- Are there overlooked fourth or fifth variables?
- Are the definitions of each element too narrow?
- **Output Format**: "The key assumptions to challenge are..."

#### Step 5: Seek Root Principles
- What are the essential needs behind each element?
- Where is the true source of conflict?
- Is there a more fundamental unifying principle?
- **Output Format**: "The underlying principles reveal that..."

#### Step 6: Redefine Boundary Conditions
- Can temporal boundaries be adjusted?
- Can spatial scope be expanded?
- Can participating entities be recombined?
- **Output Format**: "By redefining boundaries, we can..."

### LAYER 3: BREAKTHROUGH SOLUTION DESIGN

#### Step 7: Dimensional Upgrade
Explore solutions across multiple dimensions:
- **Temporal Dimension**: Phase-based implementation to resolve conflicts
- **Spatial Dimension**: Multi-layered, multi-regional solutions
- **Entity Dimension**: Collaborative division of objectives
- **Technological Dimension**: Innovation-driven game-changing approaches
- **Output Format**: "The dimensional breakthrough opportunities are..."

#### Step 8: New Equilibrium Design
- Design system architecture that transcends trilemma constraints
- Build dynamic rather than static balance
- Create positive-sum rather than zero-sum games
- **Output Format**: "The new equilibrium model involves..."

#### Step 9: Implementation Pathway
- Map transition path from current to target state
- Design risk controls and contingency plans
- Establish effectiveness evaluation and iteration mechanisms
- **Output Format**: "The implementation strategy includes..."

## Analysis Template

For each analysis, structure your response as follows:

### 🔍 **TRILEMMA IDENTIFICATION**
[Apply Steps 1-3: Identify constraints and trade-offs]

### 💭 **FIRST PRINCIPLES QUESTIONING** 
[Apply Steps 4-6: Challenge assumptions and seek root causes]

### 🚀 **BREAKTHROUGH SOLUTION**
[Apply Steps 7-9: Design innovative solutions and implementation paths]

### 📊 **SYNTHESIS & RECOMMENDATIONS**
[Provide clear, actionable insights and next steps]

## Key Principles to Follow

### Dynamic Thinking
- Constraints are not permanent
- Technological progress can change the rules
- System evolution may create new possibilities

### Multi-Level Analysis
- Solutions may exist at different hierarchical levels
- Micro-constraints ≠ Macro-constraints
- Short-term conflicts may resolve in long-term

### Creative Problem-Solving
- Best solutions often transcend original frameworks
- Redefining problems is more important than solving them
- Fourth-dimensional thinking is key to breakthroughs

## Quality Standards

Your analysis should demonstrate:
- **Accuracy** in constraint identification
- **Depth** in assumption questioning  
- **Creativity** in solution design
- **Feasibility** in implementation planning

## Special Instructions

1. **Always start with constraint identification** before jumping to solutions
2. **Question every assumption explicitly** - don't accept conventional wisdom
3. **Seek genuine breakthrough** rather than incremental improvements
4. **Balance creativity with practicality** in your recommendations
5. **Provide specific, actionable guidance** rather than abstract concepts

Your goal is to help users see beyond apparent limitations and discover innovative pathways that transcend traditional trade-offs.`;
  }

  // Obsidian API methods
  private async listVaultFiles(folder: string = '', recursive: boolean = true): Promise<string[]> {
    // List vault files
    
    try {
      // First try using the Obsidian API - but it doesn't support recursive listing
      // So we need to manually traverse folders
      const allFiles = await this.getAllFilesRecursively(folder, recursive);
      // Files found recursively
      return allFiles;
    } catch (error) {
      console.warn('API request failed, falling back to file system:', error);
      
      // Fallback to file system if API fails
      const basePath = path.join(VAULT_PATH, folder);
      return this.listFilesRecursively(basePath, recursive);
    }
  }

  // Recursive API-based file listing
  private async getAllFilesRecursively(folderPath: string, recursive: boolean = true): Promise<string[]> {
    const allFiles: string[] = [];
    
    try {
      const apiUrl = folderPath ? `/vault/${encodeURIComponent(folderPath)}` : '/vault/';
      // API call for folder
      const response = await this.api.get(apiUrl);
      // API response received
      
      const items = response.data.files || [];
      
      for (const item of items) {
        const fullPath = folderPath ? `${folderPath}/${item}` : item;
        
        // Check exclusion
        // For folders, we might want to check the path without trailing slash too
        const checkPath = fullPath.endsWith('/') ? fullPath.slice(0, -1) : fullPath;
        if (isExcluded(checkPath)) {
          continue;
        }

        if (item.endsWith('/')) {
          // It's a folder
          if (recursive) {
            // Recurse into it if recursive mode is enabled
            const folderName = item.slice(0, -1); // Remove trailing '/'
            const subFolderPath = folderPath ? `${folderPath}/${folderName}` : folderName;
            // Recurse into subfolder
            const subFiles = await this.getAllFilesRecursively(subFolderPath, recursive);
            allFiles.push(...subFiles);
          }
          // If not recursive, skip folders
        } else {
          // It's a file
          allFiles.push(fullPath);
          // Found file
        }
      }
    } catch (error) {
      // API failed for folder
      // If API fails for a specific folder, try filesystem fallback for that folder
      try {
        const basePath = path.join(VAULT_PATH, folderPath);
        const fallbackFiles = this.listFilesRecursively(basePath, recursive);
        // relativePaths are already calculated correctly in listFilesRecursively
        allFiles.push(...fallbackFiles);
      } catch (fsError) {
        // Filesystem fallback failed
      }
    }
    
    return allFiles;
  }

  private listFilesRecursively(dir: string, recursive: boolean = true): string[] {
    const files: string[] = [];
    
    const items = fs.readdirSync(dir);
    
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const relativePath = path.relative(VAULT_PATH, fullPath);

      // Check exclusion using the global isExcluded function
      if (isExcluded(relativePath)) {
        continue;
      }
      
      const stat = fs.statSync(fullPath);
      
      if (stat.isDirectory()) {
        if (recursive) {
          // Only recurse if recursive mode is enabled
          files.push(...this.listFilesRecursively(fullPath, recursive));
        }
        // If not recursive, skip directories
      } else {
        // Include all file types, not just .md files
        files.push(relativePath);
      }
    }
    
    return files;
  }

  private async readNote(notePath: string): Promise<string> {
    if (isExcluded(notePath)) {
      throw new Error(`Note not found: ${notePath}`);
    }

    try {
      // First try using the Obsidian API
      const response = await this.api.get(`/vault/${encodeURIComponent(notePath)}`);
      // API returns the content directly, not wrapped in {content: ...}
      return response.data || '';
    } catch (error) {
      console.warn('API request failed, falling back to file system:', error);
      
      // Fallback to file system if API fails
      const fullPath = path.join(VAULT_PATH, notePath);
      
      if (fs.existsSync(fullPath)) {
        return fs.readFileSync(fullPath, 'utf-8');
      } else {
        return '';
      }
    }
  }

  private async createNote(notePath: string, content: string, options: { overwrite?: boolean; dryRun?: boolean; expectedHash?: string; expectedMtime?: string | number } = {}) {
    const fullPath = getVaultFullPath(notePath);
    const exists = fs.existsSync(fullPath);
    const overwrite = options.overwrite === true;
    const dryRun = options.dryRun === true;

    if (exists && !overwrite) {
      throw new Error(`Note already exists: ${notePath}. Pass overwrite: true to replace it intentionally.`);
    }

    if (exists) {
      assertExpectedState(notePath, options.expectedHash, options.expectedMtime);
    }

    const previous = exists ? fs.readFileSync(fullPath, 'utf-8') : '';
    const diff = exists ? createUnifiedDiff(previous, content, notePath) : undefined;
    const result = {
      path: notePath,
      created: !exists,
      overwritten: exists && overwrite,
      dryRun,
      changed: !exists || normalizeLineEndings(previous) !== normalizeLineEndings(content),
      diff,
      message: exists ? `Note ${notePath} ${dryRun ? 'would be overwritten' : 'overwritten successfully'}` : `Note ${notePath} ${dryRun ? 'would be created' : 'created successfully'}`,
    };

    if (dryRun) {
      return result;
    }

    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(fullPath, content, 'utf-8');
    return result;
  }


  private async searchVault(query: string): Promise<any[]> {
    // Search vault
    
    try {
      // First try using the Obsidian API
      const apiUrl = `/search?query=${encodeURIComponent(query)}`;
      // Search API call
      const response = await this.api.get(apiUrl);
      // API response received
      // API data received
      // Check if API returns results directly or wrapped in {results: ...}
      const results = response.data.results || response.data || [];

      // Filter out excluded files
      const filteredResults = results.filter((result: any) => !isExcluded(result.path || result.filename));

      // Search results processed
      return filteredResults;
    } catch (error) {
      console.warn('API request failed, falling back to simple search:', error);
      
      // Fallback to simple search if API fails
      const files = await this.listVaultFiles();
      // Fallback search files
      // Files list processed
      const results = [];
      
      for (const file of files) {
        try {
          // Check file for matches
          const lowerQuery = query.toLowerCase();
          const lowerFileName = file.toLowerCase();
          let matchedByName = false;
          let matchedByContent = false;
          
          // Check if filename contains the query
          if (lowerFileName.includes(lowerQuery)) {
            matchedByName = true;
            // Filename match found
          }
          
          // Check if content contains the query (only for text files)
          let content = '';
          try {
            content = await this.readNote(file);
            // Read file content
            // Content preview processed
            if (typeof content === 'string' && content.toLowerCase().includes(lowerQuery)) {
              matchedByContent = true;
              // Content match found
            }
          } catch (readError) {
            // Could not read file for content search
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
            
            // Match found in file
          } else {
            // No match found
          }
        } catch (error) {
          // Skip file due to error
        }
      }
      
      return results;
    }
  }

  private async deleteNote(notePath: string): Promise<void> {
    if (isExcluded(notePath)) {
      throw new Error(`Note not found: ${notePath}`);
    }

    try {
      // First try using the Obsidian API
      await this.api.delete(`/vault/${encodeURIComponent(notePath)}`);
    } catch (error) {
      console.warn('API request failed, falling back to file system:', error);
      
      // Fallback to file system if API fails
      const fullPath = path.join(VAULT_PATH, notePath);
      
      if (!fs.existsSync(fullPath)) {
        throw new Error(`Note not found: ${notePath}`);
      }
      
      fs.unlinkSync(fullPath);
      
      // Check if parent directory is empty and remove it if it is
      const dir = path.dirname(fullPath);
      if (dir !== VAULT_PATH) {
        const items = fs.readdirSync(dir);
        if (items.length === 0) {
          fs.rmdirSync(dir);
        }
      }
    }
  }

  // PATCH 端点集成：使用 Obsidian API 进行精确插入
  private async patchNoteViaAPI(
    notePath: string, 
    heading: string, 
    content: string, 
    position: string
  ): Promise<void> {
    try {
      // 尝试使用 Obsidian Local REST API 的 PATCH 端点
      await this.api.patch(`/vault/${encodeURIComponent(notePath)}`, {
        heading: heading,
        content: content,
        insertionMode: position === 'append' ? 'append' : 
                      position === 'prepend' ? 'prepend' : 
                      position === 'before' ? 'before' : 'after'
      });
    } catch (error) {
      // API 不支持或失败，抛出错误让调用者回退到文件系统操作
      throw new Error(`PATCH API failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // 基于块ID的 PATCH 操作
  private async patchNoteViaBlockAPI(
    notePath: string, 
    blockId: string, 
    content: string, 
    position: string
  ): Promise<void> {
    try {
      // 尝试使用 Obsidian Local REST API 的块级 PATCH 端点
      await this.api.patch(`/vault/${encodeURIComponent(notePath)}`, {
        blockId: blockId,
        content: content,
        insertionMode: position === 'append' ? 'append' : 
                      position === 'prepend' ? 'prepend' : 
                      position === 'before' ? 'before' : 'after'
      });
    } catch (error) {
      // API 不支持或失败，抛出错误让调用者回退到文件系统操作
      throw new Error(`Block PATCH API failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async moveNote(sourcePath: string, destinationPath: string): Promise<void> {
    if (isExcluded(sourcePath)) {
      throw new Error(`Note not found: ${sourcePath}`);
    }
    if (isExcluded(destinationPath)) {
      throw new Error(`Cannot move note to excluded path: ${destinationPath}`);
    }

    try {
      // First try using the Obsidian API - using standard file operations
      // Most Obsidian Local REST API implementations don't support direct move operations
      // So we'll read the source file and create it at the destination, then delete the source
      
      // Read source file content via API
      const sourceResponse = await this.api.get(`/vault/${encodeURIComponent(sourcePath)}`);
      const content = sourceResponse.data.content || '';
      
      // Create destination file via API
      await this.api.post(`/vault/${encodeURIComponent(destinationPath)}`, { content });
      
      // Delete source file via API
      await this.api.delete(`/vault/${encodeURIComponent(sourcePath)}`);
      
    } catch (error) {
      // Fallback to file system operations
      const sourceFullPath = path.join(VAULT_PATH, sourcePath);
      const destFullPath = path.join(VAULT_PATH, destinationPath);
      
      // Validate source file exists
      if (!fs.existsSync(sourceFullPath)) {
        throw new Error(`Source note not found: ${sourcePath}`);
      }
      
      // Check if destination already exists
      if (fs.existsSync(destFullPath)) {
        throw new Error(`Destination already exists: ${destinationPath}`);
      }
      
      // Create destination directory if it doesn't exist
      const destDir = path.dirname(destFullPath);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }
      
      // Use filesystem rename (works for all file types including PDF)
      try {
        fs.renameSync(sourceFullPath, destFullPath);
      } catch (renameError) {
        throw new Error(`Failed to move file: ${renameError}`);
      }
      
      // Clean up empty source directory if needed
      const sourceDir = path.dirname(sourceFullPath);
      if (sourceDir !== VAULT_PATH) {
        try {
          const items = fs.readdirSync(sourceDir);
          if (items.length === 0) {
            fs.rmdirSync(sourceDir);
          }
        } catch (error) {
          // Ignore errors when cleaning up empty directories
        }
      }
    }
  }

  // Folder operation methods
  private async createFolder(folderPath: string): Promise<void> {
    try {
      // First try using the Obsidian API
      await this.api.post(`/folders/${encodeURIComponent(folderPath)}`);
    } catch (error) {
      console.warn('API request failed, falling back to file system:', error);
      
      // Fallback to file system if API fails
      const fullPath = path.join(VAULT_PATH, folderPath);
      
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
      }
    }
  }

  private async renameFolder(folderPath: string, newPath: string): Promise<void> {
    try {
      // First try using the Obsidian API
      await this.api.put(`/folders/${encodeURIComponent(folderPath)}`, { newPath });
    } catch (error) {
      console.warn('API request failed, falling back to file system:', error);
      
      // Fallback to file system if API fails
      const fullPath = path.join(VAULT_PATH, folderPath);
      const newFullPath = path.join(VAULT_PATH, newPath);
      
      if (!fs.existsSync(fullPath)) {
        throw new Error(`Folder not found: ${folderPath}`);
      }
      
      if (fs.existsSync(newFullPath)) {
        throw new Error(`Destination folder already exists: ${newPath}`);
      }
      
      // Create parent directory if it doesn't exist
      const parentDir = path.dirname(newFullPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      
      fs.renameSync(fullPath, newFullPath);
    }
  }

  private async moveFolder(folderPath: string, newPath: string): Promise<void> {
    // Move is essentially the same as rename in this context
    await this.renameFolder(folderPath, newPath);
  }

  private async deleteFolder(folderPath: string): Promise<void> {
    try {
      // First try using the Obsidian API
      await this.api.delete(`/folders/${encodeURIComponent(folderPath)}`);
    } catch (error) {
      console.warn('API request failed, falling back to file system:', error);
      
      // Fallback to file system if API fails
      const fullPath = path.join(VAULT_PATH, folderPath);
      
      if (!fs.existsSync(fullPath)) {
        throw new Error(`Folder not found: ${folderPath}`);
      }
      
      // Recursively delete the folder and its contents
      this.deleteFolderRecursive(fullPath);
    }
  }

  private deleteFolderRecursive(folderPath: string): void {
    if (fs.existsSync(folderPath)) {
      fs.readdirSync(folderPath).forEach((file) => {
        const curPath = path.join(folderPath, file);
        if (fs.lstatSync(curPath).isDirectory()) {
          // Recursive call for directories
          this.deleteFolderRecursive(curPath);
        } else {
          // Delete file
          fs.unlinkSync(curPath);
        }
      });
      // Delete empty directory
      fs.rmdirSync(folderPath);
    }
  }

  // Start the server
  async run() {
    if (TRANSPORT_MODE === 'http') {
      await this.startHttpServer();
    } else {
      await this.startStdioServer();
    }
  }

  private async startStdioServer() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Obsidian MCP server running on stdio');
  }

  private async startHttpServer() {
    const httpServer = createServer();
    const activeTransports = new Map<string, SSEServerTransport>();

    httpServer.on('request', async (req: IncomingMessage, res: ServerResponse) => {
      try {
        const url = new URL(req.url!, `http://${req.headers.host}`);
        const path = url.pathname;
        const sessionId = url.searchParams.get('sessionId');

        // CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        if (req.method === 'OPTIONS') {
          res.writeHead(200);
          res.end();
          return;
        }

        if (path === '/sse' && req.method === 'GET') {
          // Set SSE headers before creating transport
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');
          
          // Handle SSE connection
          const transport = new SSEServerTransport('/messages', res);
          await this.server.connect(transport);
          activeTransports.set(transport.sessionId, transport);
          
          console.error(`[INFO] SSE connection established with session ID: ${transport.sessionId}`);
          
          // Clean up when connection closes
          transport.onclose = () => {
            activeTransports.delete(transport.sessionId);
            console.error(`[INFO] SSE connection closed for session ID: ${transport.sessionId}`);
          };
          
        } else if (path === '/messages' && req.method === 'POST') {
          // Handle POST messages
          if (!sessionId) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Missing sessionId parameter');
            return;
          }

          const transport = activeTransports.get(sessionId);
          if (!transport) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Session not found');
            return;
          }

          await transport.handlePostMessage(req, res);
          
        } else {
          // Handle other requests
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not found');
        }
      } catch (error) {
        console.error('HTTP request error:', error);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal server error');
      }
    });

    httpServer.listen(HTTP_PORT, HTTP_HOST, () => {
      console.error(`[INFO] Obsidian MCP server running on HTTP ${HTTP_HOST}:${HTTP_PORT}`);
      console.error(`[INFO] SSE endpoint: http://${HTTP_HOST}:${HTTP_PORT}/sse`);
      console.error(`[INFO] Messages endpoint: http://${HTTP_HOST}:${HTTP_PORT}/messages`);
    });
  }
}

// Validate transport mode
if (TRANSPORT_MODE !== 'stdio' && TRANSPORT_MODE !== 'http') {
  console.error(`[ERROR] Invalid transport mode: ${TRANSPORT_MODE}. Must be 'stdio' or 'http'`);
  process.exit(1);
}

// Create and run the server
const server = new ObsidianMcpServer();
server.run().catch(console.error);
