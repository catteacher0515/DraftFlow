# DraftFlow v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a macOS Electron tool that turns one Markdown file into one new Juejin draft with local-image upload and task-history persistence.

**Architecture:** Electron owns the desktop UI and IPC boundary. A focused sync core owns parsing, asset resolution, session persistence, Juejin upload/create calls, and task-history storage. Juejin draft creation uses authenticated HTTP calls from a Playwright browser context instead of brittle editor DOM typing.

**Tech Stack:** Electron, TypeScript, Vite, Playwright, Vitest, unified/remark, Zod

---

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `vite.config.ts`
- Create: `electron.vite.config.ts`
- Create: `.gitignore`

- [ ] Add package metadata, scripts, and dependencies for Electron, Vite, Playwright, Vitest, unified, remark, and Zod.
- [ ] Add TypeScript compiler settings for Node and renderer builds.
- [ ] Add Vite config for renderer bundle and Electron main/preload bundle.
- [ ] Add `.gitignore` entries for dependencies, dist output, Playwright artifacts, and local app data.

### Task 2: Core Types And Parser Tests

**Files:**
- Create: `src/core/types.ts`
- Create: `tests/fixtures/sample-article.md`
- Create: `tests/markdown-parser.test.ts`

- [ ] Define shared types for parsed documents, images, sync requests, sync results, and task history entries.
- [ ] Add a sample Markdown fixture with H1, local image, remote image, code block, and link.
- [ ] Write failing tests for H1 extraction, image classification, and title fallback behavior.

### Task 3: Markdown Parser And Asset Resolver

**Files:**
- Create: `src/core/markdown/markdown-parser.ts`
- Create: `src/core/markdown/asset-resolver.ts`
- Modify: `tests/markdown-parser.test.ts`

- [ ] Implement Markdown parsing that preserves source Markdown while extracting H1 and image references.
- [ ] Implement asset resolution that classifies local vs remote images and resolves absolute file paths against the source file directory.
- [ ] Run parser tests until green.

### Task 4: Task Store Tests And Implementation

**Files:**
- Create: `tests/task-store.test.ts`
- Create: `src/core/task-store.ts`

- [ ] Write failing tests for task history append, list ordering, and empty-store bootstrap.
- [ ] Implement JSON-backed task history persistence under an app-data directory.
- [ ] Run task store tests until green.

### Task 5: Session Store

**Files:**
- Create: `src/core/session-store.ts`
- Create: `tests/session-store.test.ts`

- [ ] Write failing tests for storage-state path resolution and state existence checks.
- [ ] Implement Juejin session-state file helpers and lazy directory creation.
- [ ] Run session store tests until green.

### Task 6: Juejin Payload Builder

**Files:**
- Create: `src/core/juejin/juejin-payload.ts`
- Create: `tests/juejin-payload.test.ts`

- [ ] Write failing tests for Juejin draft payload generation from parsed Markdown, resolved title, and uploaded image mappings.
- [ ] Implement payload generation for `mark_content`, `title`, and image URL replacement.
- [ ] Run payload tests until green.

### Task 7: Juejin Adapter

**Files:**
- Create: `src/core/juejin/juejin-adapter.ts`
- Create: `src/core/juejin/juejin-image-upload.ts`
- Create: `src/core/juejin/juejin-api.ts`

- [ ] Implement Playwright browser-context bootstrap with persistent login state.
- [ ] Implement authenticated request helper that executes Juejin HTTP calls from the browser context.
- [ ] Implement local image upload through Juejin image APIs and draft creation through `article_draft/create`.

### Task 8: Sync Runner

**Files:**
- Create: `src/core/sync-runner.ts`
- Create: `tests/sync-runner.test.ts`

- [ ] Write failing tests for sync success, warning on failed local image, and title-required failure.
- [ ] Implement orchestration from file read through parser, asset resolver, Juejin adapter, and task store.
- [ ] Run sync runner tests until green with adapter mocked.

### Task 9: Electron Shell

**Files:**
- Create: `src/main.ts`
- Create: `src/preload.ts`
- Create: `src/renderer/index.html`
- Create: `src/renderer/main.ts`
- Create: `src/renderer/App.ts`
- Create: `src/renderer/styles.css`

- [ ] Create Electron main process window bootstrap and IPC handlers.
- [ ] Expose file picker, login action, sync action, and task-history read through preload.
- [ ] Build a small renderer UI for file selection, title entry, login status, sync trigger, and result display.

### Task 10: Verification

**Files:**
- Modify: `package.json`
- Create: `README.md`

- [ ] Add scripts for unit tests, dev run, and smoke launch.
- [ ] Write a concise README for local setup and live validation steps.
- [ ] Run tests and a local startup smoke check.
