# DraftFlow

DraftFlow v1 is a local Electron tool that turns one Markdown file into one new platform draft.

## Scripts

- `npm install`
- `npm run test`
- `npm run dev`
- `npm run build`

## Current State

- Renderer UI exists
- Local parsing and task logic are covered by unit tests
- Electron IPC is wired
- Juejin sync can create new drafts and persists local task history/snapshots
- Retry now reuses the saved local snapshot instead of depending on the source file still existing
- Markdown preprocessing strips frontmatter, normalizes Obsidian image syntax, and degrades failed images to text placeholders
- Zhihu adapter is wired as a first-pass Playwright integration and still needs authenticated live verification against the real editor

## Next Integration Step

Run authenticated live verification for Zhihu editor selectors and save behavior, then tighten the adapter around the confirmed DOM.
