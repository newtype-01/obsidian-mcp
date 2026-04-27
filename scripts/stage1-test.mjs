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
const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-mcp-stage1-'));

function textFromResult(result) {
  return result.content?.map((item) => item.text || '').join('\n') || '';
}

function jsonFromResult(result) {
  return JSON.parse(textFromResult(result));
}

async function expectReject(label, fn) {
  try {
    await fn();
  } catch {
    return;
  }
  throw new Error(`Expected ${label} to reject`);
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

const client = new Client({ name: 'stage1-test', version: '1.0.0' }, { capabilities: {} });

try {
  await client.connect(transport);

  const tools = await client.listTools();
  const toolNames = new Set(tools.tools.map((tool) => tool.name));
  for (const name of [
    'get_note_metadata',
    'get_properties',
    'set_properties',
    'remove_properties',
    'format_wikilink',
    'insert_wikilink',
    'insert_embed',
    'insert_callout',
    'append_task',
    'toggle_task',
  ]) {
    if (!toolNames.has(name)) {
      throw new Error(`Missing Stage 1 tool: ${name}`);
    }
  }

  await client.callTool({
    name: 'create_note',
    arguments: {
      path: 'Stage1.md',
      content: [
        '---',
        'title: Stage One',
        'tags:',
        '  - old',
        '---',
        '# Heading',
        '',
        'Original line.',
        'Inline block target. ^inline-id',
        '- [ ] Task item',
        '',
      ].join('\n'),
    },
  });

  await expectReject('create_note overwrite without flag', () => client.callTool({
    name: 'create_note',
    arguments: { path: 'Stage1.md', content: 'clobber' },
  }));

  const dryOverwrite = jsonFromResult(await client.callTool({
    name: 'create_note',
    arguments: { path: 'Stage1.md', content: 'clobber', overwrite: true, dryRun: true },
  }));
  if (!dryOverwrite.diff || !dryOverwrite.dryRun) {
    throw new Error('Expected overwrite dry-run diff');
  }

  const dryUpdate = jsonFromResult(await client.callTool({
    name: 'update_note',
    arguments: {
      path: 'Stage1.md',
      dryRun: true,
      edits: [{ oldText: 'Original line.', newText: 'Replacement line.', expectedCount: 1 }],
    },
  }));
  if (!dryUpdate.diff || !dryUpdate.edits?.[0]?.matchCount) {
    throw new Error('Expected structured dry-run update result');
  }

  await expectReject('ambiguous replace', () => client.callTool({
    name: 'update_note',
    arguments: {
      path: 'Stage1.md',
      edits: [{ oldText: 'line', newText: 'LINE', expectedCount: 1 }],
    },
  }));

  const rangeUpdate = jsonFromResult(await client.callTool({
    name: 'update_note',
    arguments: {
      path: 'Stage1.md',
      edits: [{ mode: 'replaceRange', startLine: 8, endLine: 8, newContent: 'Range replacement.' }],
    },
  }));
  if (!rangeUpdate.changed) {
    throw new Error('Expected replaceRange to change the note');
  }

  await client.callTool({
    name: 'update_note',
    arguments: {
      path: 'Stage1.md',
      edits: [{ mode: 'insert', blockId: 'inline-id', content: '\nInserted after inline block.\n', position: 'after' }],
    },
  });

  const props = jsonFromResult(await client.callTool({
    name: 'set_properties',
    arguments: { path: 'Stage1.md', properties: { status: 'active', tags: ['old', 'new'] } },
  }));
  if (!props.properties?.status) {
    throw new Error('Expected set_properties to return updated status');
  }

  await expectReject('hash guard mismatch', () => client.callTool({
    name: 'set_properties',
    arguments: {
      path: 'Stage1.md',
      properties: { guarded: true },
      expectedHash: 'not-the-current-hash',
    },
  }));

  await client.callTool({
    name: 'remove_properties',
    arguments: { path: 'Stage1.md', keys: ['status'] },
  });

  const link = textFromResult(await client.callTool({
    name: 'format_wikilink',
    arguments: { target: 'Other Note', alias: 'Other', heading: 'Section' },
  })).trim();
  if (link !== '[[Other Note#Section|Other]]') {
    throw new Error(`Unexpected wikilink output: ${link}`);
  }

  await client.callTool({
    name: 'insert_callout',
    arguments: { path: 'Stage1.md', type: 'note', title: 'Heads up', content: 'Callout body' },
  });
  await client.callTool({
    name: 'append_task',
    arguments: { path: 'Stage1.md', content: 'Second task' },
  });
  await client.callTool({
    name: 'toggle_task',
    arguments: { path: 'Stage1.md', textMatch: 'Task item', checked: true },
  });

  const metadata = jsonFromResult(await client.callTool({
    name: 'get_note_metadata',
    arguments: { path: 'Stage1.md' },
  }));
  if (!metadata.blockIds?.some((block) => block.id === 'inline-id')) {
    throw new Error('Expected metadata to include inline block ID');
  }
  if (!metadata.tags?.includes('new')) {
    throw new Error('Expected metadata to include frontmatter tags');
  }

  console.log('Stage 1 MCP integration test passed.');
} finally {
  await client.close().catch(() => {});
  fs.rmSync(vaultPath, { recursive: true, force: true });
}
