import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const buildEntry = path.join(repoRoot, 'build', 'index.js');
const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-mcp-stage2-'));

function textFromResult(result) {
  return result.content?.map((item) => item.text || '').join('\n') || '';
}

function jsonFromResult(result) {
  return JSON.parse(textFromResult(result));
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [buildEntry],
  env: {
    ...process.env,
    OBSIDIAN_VAULT_PATH: vaultPath,
    OBSIDIAN_API_TOKEN: '',
  },
});

const client = new Client({ name: 'stage2-test', version: '1.0.0' }, { capabilities: {} });

try {
  await client.connect(transport);

  const tools = await client.listTools();
  const toolNames = new Set(tools.tools.map((tool) => tool.name));
  for (const name of [
    'get_base',
    'validate_base',
    'create_base',
    'add_base_view',
    'update_base_view',
    'set_base_filters',
    'set_base_formula',
    'insert_base_embed',
    'query_base',
  ]) {
    if (!toolNames.has(name)) {
      throw new Error(`Missing Stage 2 tool: ${name}`);
    }
  }

  await client.callTool({
    name: 'create_note',
    arguments: {
      path: 'PhD/Management/Chapter 1 v1.md',
      content: [
        '---',
        'kind: chapter',
        'canonical: true',
        'version: 1',
        '---',
        '# Chapter 1',
      ].join('\n'),
    },
  });

  await client.callTool({
    name: 'create_note',
    arguments: {
      path: 'PhD/Management/Chapter 1 notes.md',
      content: [
        '---',
        'kind: notes',
        'canonical: false',
        'version: 0',
        '---',
        '# Notes',
      ].join('\n'),
    },
  });

  const created = jsonFromResult(await client.callTool({
    name: 'create_base',
    arguments: {
      path: 'PhD/Management/chapter-index.base',
      filters: {
        and: [
          'file.inFolder("PhD/Management")',
          'file.ext == "md"',
          '/^Chapter \\d+ v\\d+\\.md$/.matches(file.name)',
          'kind == "chapter"',
          'canonical == true',
        ],
      },
      formulas: {
        age_days: '(now() - file.mtime).days',
      },
      views: [{
        type: 'table',
        name: 'Canonical Chapters',
        order: ['file.name', 'file.path', 'version', 'file.mtime', 'formula.age_days'],
      }],
    },
  }));
  if (!created.validation?.valid) {
    throw new Error('Expected created base to validate');
  }

  const validation = jsonFromResult(await client.callTool({
    name: 'validate_base',
    arguments: { path: 'PhD/Management/chapter-index.base' },
  }));
  if (!validation.valid) {
    throw new Error(`Expected valid base: ${validation.errors?.join('; ')}`);
  }

  await client.callTool({
    name: 'set_base_formula',
    arguments: {
      path: 'PhD/Management/chapter-index.base',
      name: 'basename',
      expression: 'file.basename',
    },
  });

  await client.callTool({
    name: 'add_base_view',
    arguments: {
      path: 'PhD/Management/chapter-index.base',
      view: {
        type: 'table',
        name: 'By Version',
        order: ['file.name', 'version', 'formula.basename'],
      },
    },
  });

  await client.callTool({
    name: 'update_base_view',
    arguments: {
      path: 'PhD/Management/chapter-index.base',
      viewName: 'By Version',
      patch: { limit: 20 },
    },
  });

  const query = jsonFromResult(await client.callTool({
    name: 'query_base',
    arguments: {
      path: 'PhD/Management/chapter-index.base',
      viewName: 'Canonical Chapters',
      sortBy: 'file.name',
    },
  }));
  if (query.total !== 1 || query.rows[0]?.path !== 'PhD/Management/Chapter 1 v1.md') {
    throw new Error(`Expected query_base to return only canonical chapter, got ${JSON.stringify(query.rows)}`);
  }
  if (query.rows[0].values.version !== 1) {
    throw new Error('Expected query_base to expose frontmatter version');
  }

  await client.callTool({
    name: 'create_note',
    arguments: { path: 'Dashboard.md', content: '# Dashboard\n' },
  });
  await client.callTool({
    name: 'insert_base_embed',
    arguments: {
      path: 'Dashboard.md',
      basePath: 'PhD/Management/chapter-index.base',
      viewName: 'Canonical Chapters',
    },
  });
  const dashboard = textFromResult(await client.callTool({
    name: 'read_note',
    arguments: { path: 'Dashboard.md' },
  }));
  if (!dashboard.includes('![[PhD/Management/chapter-index.base#Canonical Chapters]]')) {
    throw new Error('Expected base embed in dashboard note');
  }

  console.log('Stage 2 Bases MCP integration test passed.');
} finally {
  await client.close().catch(() => {});
  fs.rmSync(vaultPath, { recursive: true, force: true });
}
