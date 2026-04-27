# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- **Concurrency-Safe File State Guards**:
  - Added optional `expectedHash` and `expectedMtime` precondition checks to mutating workflows
  - Added file state metadata (hash/mtime/ctime/size) for safer AI-driven edit loops
- **Structured Note Edit Engine (V2)**:
  - Added `replaceRange` mode in `update_note` for explicit line-range replacement
  - Added `expectedCount` support for replace operations to prevent ambiguous replacements
  - `update_note` now returns structured edit results and optional unified diff output
- **Frontmatter + Metadata Tooling (Stage 1)**:
  - Added `get_note_metadata` for headings, block IDs, links, tags, and file state
  - Added `get_properties`, `set_properties`, and `remove_properties` for YAML frontmatter management
  - Added Markdown insertion helpers: `format_wikilink`, `insert_wikilink`, `insert_embed`, `insert_callout`, `append_task`, `toggle_task`
- **Obsidian Bases Tooling (Stage 2)**:
  - Added `get_base`, `validate_base`, `create_base`, `add_base_view`, `update_base_view`, `set_base_filters`, `set_base_formula`, `insert_base_embed`, and `query_base`
  - Added validation for base filters/formulas/views with warnings for high-cost patterns
  - Added lightweight formula/filter evaluation to support server-side base querying
- **Create Note Safety Enhancements**:
  - `create_note` now supports `overwrite` and `dryRun`
  - Create operations now return structured results with creation/overwrite status and optional diff
- **Integration Test Expansion**:
  - Added `scripts/stage1-test.mjs` for Stage 1 tool coverage
  - Added `scripts/stage2-test.mjs` for Stage 2 base workflow coverage
  - `npm test` now runs smoke tests plus Stage 1 and Stage 2 integration suites
- **Dependency Update**:
  - Added `yaml` runtime dependency for frontmatter and base document parsing/serialization

- **Search Controls for Large Vaults**:
  - `search_vault` now supports `limit`, `offset`, `pathPrefix`, `extensions`, `matchType`, `sortBy`, and `sortDirection`
  - Search responses now include `total`, `returned`, `hasMore`, and paged `results`
  - Input validation errors are explicit to reduce malformed tool calls from AI clients
- **Exclusion Settings Support**: Automatic loading of Obsidian's user-configured file exclusion patterns from `.obsidian/app.json`
  - Reads `userIgnoreFilters` array from Obsidian's app configuration
  - Built-in default exclusions for `.obsidian`, `.git`, and `.DS_Store`
  - Smart pattern matching supporting directory-level and file-level exclusions
- **Exclusion Awareness in Tools**:
  - `list_notes`: Respects exclusion patterns - excluded files/folders won't appear in listings
  - `search_vault`: Excludes files in excluded paths from search results
  - `read_note` & `read_multiple_notes`: Respect exclusion rules for direct reads

### Implementation Details

- New function `loadExclusions()`: Safely loads exclusion patterns from `.obsidian/app.json` with fallback to defaults
- New function `isExcluded()`: Efficiently checks if a file path matches any exclusion pattern
- Glob-based exclusion matching now supports wildcard-style patterns from Obsidian ignore filters
- Pattern matching handles path separators correctly across platforms (Windows/Unix)

### How It Works

1. On server startup, the system reads `.obsidian/app.json` in the vault directory
2. If `userIgnoreFilters` array exists, those patterns are loaded
3. These patterns are combined with default exclusions
4. All vault operations (`list_notes`, `search_vault`) respect these exclusions
5. Direct file reads (`read_note`) follow the same exclusion rules

## Previous Versions

For previous version history, please see the main repository commit history.

### Version 1.7.0

- Added auto backlink generation feature (`auto_backlink_vault` tool)
- Added strategic insights analysis (`notes_insight` tool)
- Support for recursive file listing control

### Version 1.6.0

- Enhanced `update_note` tool with PATCH precision insertion
- Added heading-based insertion (before/after/append/prepend)
- Added block ID-based insertion with `^block-id` support
- PATCH API integration with filesystem fallback

### Version 1.5.0 and earlier

- Core note management tools
- Folder operations
- Full-text search
- Obsidian REST API integration
