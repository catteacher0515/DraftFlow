# DraftFlow v1 Design

**Goal**

Build a macOS local tool that takes one Markdown file and creates one new Juejin draft reliably.

**Scope**

- macOS local app
- Electron shell
- One file per sync
- One platform: Juejin
- Markdown article only
- Each sync creates a new draft
- Local images upload to Juejin
- Remote image URLs stay unchanged
- Manual title overrides extracted H1
- Cache stores task history and failures only

**Out of Scope**

- Zhihu
- Video workflows
- Draft update detection
- In-app writing editor
- Batch sync
- Complex Markdown guarantees for tables, math, HTML blocks, footnotes

**Architecture**

The app is split into an Electron shell and a sync core. The shell owns desktop UI, file picking, title input, sync trigger, and result display. The sync core owns Markdown parsing, image classification, Juejin session management, image upload, draft creation, and task history persistence.

The Juejin adapter uses a hybrid strategy. Playwright owns authenticated browser context and cookie persistence. Draft creation uses Juejin's own article draft HTTP endpoints from the authenticated browser context. Image upload follows Juejin's actual image pipeline: local files upload through the `imagex` flow; remote URLs use Juejin's `image/urlSave` flow when needed internally, though v1 leaves remote image URLs untouched in source content.

**Main Flow**

1. User selects one Markdown file.
2. User optionally enters a title.
3. Sync core reads file and parses title, content, and image references.
4. Sync core validates title and local image existence.
5. Session store loads or refreshes Juejin login state.
6. Juejin adapter uploads local images and rewrites Markdown image URLs.
7. Juejin adapter creates one new Juejin draft via authenticated HTTP request.
8. Task store records success, warnings, failed images, and source file path.
9. UI shows final result.

**Content Rules**

- Final title priority:
  1. User-entered title
  2. First H1 extracted from Markdown
  3. Otherwise block sync
- Guaranteed Markdown blocks:
  - headings
  - paragraphs
  - bold
  - lists
  - blockquotes
  - fenced code blocks
  - links
  - images
- Remote images are preserved as-is.
- Local image upload failure becomes a warning, not a hard stop.

**Failure Semantics**

- Missing final title: fail task before network calls.
- Missing source file: fail task.
- Missing local image file: warning, continue sync.
- Local image upload failure: warning, continue sync.
- Invalid or expired login state: fail task and require re-login.
- Draft create API failure: fail task.

**Persistence**

Application data lives under the Electron app data directory.

- `sessions/juejin/storage-state.json`
  - Playwright storage state for login reuse
- `tasks/history.json`
  - append-only task history records

Task records include:

- task id
- platform
- source file
- resolved title
- start/end time
- status
- draft id
- draft URL
- uploaded image count
- failed image list
- warnings
- error message

**UI Shape**

v1 is a small utility window, not an editor.

- file picker
- title input
- parsed file summary
- sync button
- login status
- task result panel
- recent task list

**Testing Strategy**

- Unit tests for Markdown parsing, title resolution, and asset classification
- Unit tests for task history persistence
- Adapter contract tests around request payload generation
- One smoke script for Electron startup
- Manual live validation for Juejin login and draft creation

**Risks**

- Juejin private APIs are unofficial and may change.
- Image upload uses Juejin web internals and may drift.
- Electron packaging is not part of the first coding milestone; initial goal is local dev run.
