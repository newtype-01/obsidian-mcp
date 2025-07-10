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
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { URL } from 'url';
import { createTwoFilesPatch } from 'diff';

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
  mode?: 'replace' | 'insert';
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
    if (!edit.heading && !edit.blockId) {
      errors.push('Insert mode requires either heading or blockId');
    }
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
        // Get list of files in the vault
        const files = await this.listVaultFiles();
        
        // Map files to resources
        const resources = files.map(file => ({
          uri: `obsidian://${encodeURIComponent(file)}`,
          name: path.basename(file),
          mimeType: 'text/markdown',
          description: `Markdown note: ${file}`,
        }));
        
        return { resources };
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
          description: 'List all notes in the Obsidian vault',
          inputSchema: {
            type: 'object',
            properties: {
              folder: {
                type: 'string',
                description: 'Folder path within the vault (optional)',
              },
            },
            required: [],
          },
        },
        {
          name: 'delete_note',
          description: 'Delete a note from the Obsidian vault',
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
          description: 'Read the content of a note in the Obsidian vault',
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
          description: 'Create a new note in the Obsidian vault',
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
            },
            required: ['path', 'content'],
          },
        },
        {
          name: 'search_vault',
          description: 'Search for content in the Obsidian vault',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Search query',
              },
            },
            required: ['query'],
          },
        },
        {
          name: 'move_note',
          description: 'Move or rename a note to a new location in the Obsidian vault',
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
          description: 'Create, rename, move, or delete a folder in the Obsidian vault',
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
          description: 'Update content in an existing note using text replacements or precise insertions',
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
                    
                    // 插入模式
                    mode: {
                      type: 'string',
                      enum: ['replace', 'insert'],
                      description: 'Edit mode: replace (default) or insert',
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
              }
            },
            required: ['path', 'edits'],
          },
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
    const files = await this.listVaultFiles(folder);
    
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
    
    await this.createNote(args.path, args.content);
    
    return {
      content: [
        {
          type: 'text',
          text: `Note created successfully at ${args.path}`,
        },
      ],
    };
  }


  private async handleSearchVault(args: any) {
    if (!args?.query) {
      throw new Error('Search query is required');
    }
    
    const results = await this.searchVault(args.query);
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(results, null, 2),
        },
      ],
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
    
    if (!Array.isArray(args.edits)) {
      throw new Error('Edits must be an array');
    }
    
    const dryRun = args.dryRun || false;
    const notePath = args.path;
    const edits = args.edits;
    
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
    try {
      const promptPath = path.join(process.cwd(), 'notes_insight_prompt.md');
      if (fs.existsSync(promptPath)) {
        return fs.readFileSync(promptPath, 'utf-8');
      }
      
      // Fallback to embedded prompt if file doesn't exist
      return `# TRILEMMA-PRINCIPLES Analysis Framework
      
Apply strategic analysis to identify constraints, challenge assumptions, and generate breakthrough solutions.

## Framework Steps:
1. Identify the core trilemma (three conflicting elements)
2. Analyze constraint sources and trade-offs
3. Challenge fundamental assumptions
4. Seek root principles and redefine boundaries
5. Design breakthrough solutions across multiple dimensions
6. Create new equilibrium and implementation pathway

## Output Format:
- TRILEMMA IDENTIFICATION: [constraints and trade-offs]
- FIRST PRINCIPLES QUESTIONING: [assumption challenges]
- BREAKTHROUGH SOLUTION: [innovative approaches]
- SYNTHESIS & RECOMMENDATIONS: [actionable insights]`;
    } catch (error) {
      console.warn('Failed to load TRILEMMA prompt:', error);
      return 'Please analyze the topic using strategic thinking principles.';
    }
  }

  // Obsidian API methods
  private async listVaultFiles(folder: string = ''): Promise<string[]> {
    // List vault files
    
    try {
      // First try using the Obsidian API - but it doesn't support recursive listing
      // So we need to manually traverse folders
      const allFiles = await this.getAllFilesRecursively('');
      // Files found recursively
      return allFiles;
    } catch (error) {
      console.warn('API request failed, falling back to file system:', error);
      
      // Fallback to file system if API fails
      const basePath = path.join(VAULT_PATH, folder);
      return this.listFilesRecursively(basePath);
    }
  }

  // Recursive API-based file listing
  private async getAllFilesRecursively(folderPath: string): Promise<string[]> {
    const allFiles: string[] = [];
    
    try {
      const apiUrl = folderPath ? `/vault/${encodeURIComponent(folderPath)}` : '/vault/';
      // API call for folder
      const response = await this.api.get(apiUrl);
      // API response received
      
      const items = response.data.files || [];
      
      for (const item of items) {
        const fullPath = folderPath ? `${folderPath}/${item}` : item;
        
        if (item.endsWith('/')) {
          // It's a folder, recurse into it
          const folderName = item.slice(0, -1); // Remove trailing '/'
          const subFolderPath = folderPath ? `${folderPath}/${folderName}` : folderName;
          // Recurse into subfolder
          const subFiles = await this.getAllFilesRecursively(subFolderPath);
          allFiles.push(...subFiles);
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
        const fallbackFiles = this.listFilesRecursively(basePath);
        // relativePaths are already calculated correctly in listFilesRecursively
        allFiles.push(...fallbackFiles);
      } catch (fsError) {
        // Filesystem fallback failed
      }
    }
    
    return allFiles;
  }

  private listFilesRecursively(dir: string): string[] {
    const files: string[] = [];
    
    const items = fs.readdirSync(dir);
    
    for (const item of items) {
      if (item === '.obsidian' || item === '.git' || item === '.DS_Store') {
        continue;
      }
      
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);
      
      if (stat.isDirectory()) {
        files.push(...this.listFilesRecursively(fullPath));
      } else {
        // Include all file types, not just .md files
        const relativePath = path.relative(VAULT_PATH, fullPath);
        files.push(relativePath);
      }
    }
    
    return files;
  }

  private async readNote(notePath: string): Promise<string> {
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

  private async createNote(notePath: string, content: string): Promise<void> {
    try {
      // First try using the Obsidian API
      await this.api.post(`/vault/${encodeURIComponent(notePath)}`, { content });
    } catch (error) {
      console.warn('API request failed, falling back to file system:', error);
      
      // Fallback to file system if API fails
      const fullPath = path.join(VAULT_PATH, notePath);
      const dir = path.dirname(fullPath);
      
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      fs.writeFileSync(fullPath, content, 'utf-8');
    }
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
      // Search results processed
      return results;
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
