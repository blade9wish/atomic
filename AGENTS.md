# Atomic - Note-Taking Desktop Application

## Project Overview
Atomic is a Tauri v2 desktop application for note-taking with a React frontend. It features markdown editing, hierarchical tagging, and is designed to support AI-powered semantic search in future phases.

## Tech Stack
- **Desktop Framework**: Tauri v2 (Rust backend)
- **Frontend**: React 18+ with TypeScript
- **Build Tool**: Vite
- **Styling**: Tailwind CSS v4 (using `@tailwindcss/vite` plugin)
- **State Management**: Zustand
- **Database**: SQLite with sqlite-vec extension (via rusqlite)
- **Markdown Editor**: CodeMirror 6 (`@uiw/react-codemirror`)
- **Markdown Rendering**: react-markdown with remark-gfm

## Project Structure
```
/src-tauri
  /src
    main.rs           # Tauri entry point, command registration
    db.rs             # SQLite setup, migrations, connection pool
    commands.rs       # All Tauri command implementations
    models.rs         # Rust structs for data
  Cargo.toml
  tauri.conf.json

/src
  /components
    /layout           # LeftPanel, MainView, RightDrawer, Layout
    /atoms            # AtomCard, AtomEditor, AtomViewer, AtomGrid, AtomList
    /tags             # TagTree, TagNode, TagChip, TagSelector
    /ui               # Button, Input, Modal, FAB, ContextMenu
  /stores             # Zustand stores (atoms.ts, tags.ts, ui.ts)
  /hooks              # Custom hooks (useClickOutside, useKeyboard)
  /lib                # Utilities (tauri.ts, markdown.ts, date.ts)
  App.tsx
  main.tsx
  index.css           # Tailwind imports

/index.html
/vite.config.ts
/package.json
```

## Common Commands

### Development
```bash
# Install dependencies
npm install

# Run development server (frontend + Tauri)
npm run tauri dev

# Build for production
npm run tauri build
```

### Database
The SQLite database is stored in the Tauri app data directory:
- macOS: `~/Library/Application Support/com.atomic.app/`
- Linux: `~/.local/share/com.atomic.app/`
- Windows: `%APPDATA%/com.atomic.app/`

## Database Schema
- `atoms`: Core content units with markdown content
- `tags`: Hierarchical tags with parent_id for nesting
- `atom_tags`: Many-to-many relationship between atoms and tags
- `atom_chunks`: For future embedding storage (Phase 2)

## Key Dependencies

### Rust (Cargo.toml)
- `tauri` = "2"
- `rusqlite` = { version = "0.32", features = ["bundled"] }
- `sqlite-vec` = "0.1.6"
- `serde` = { version = "1", features = ["derive"] }
- `serde_json` = "1"
- `uuid` = { version = "1", features = ["v4"] }
- `chrono` = { version = "0.4", features = ["serde"] }

### Frontend (package.json)
- `@tauri-apps/api` = "^2.0.0"
- `@tauri-apps/cli` = "^2.0.0"
- `react` = "^18.2.0"
- `zustand` = "^4.5.0"
- `@uiw/react-codemirror` = "^4.23.0"
- `@codemirror/lang-markdown` = "^6.0.0"
- `react-markdown` = "^9.0.0"
- `remark-gfm` = "^4.0.0"
- `tailwindcss` = "^4.0.0"
- `@tailwindcss/vite` = "^4.0.0"

## Design System (Dark Theme)
- Background: #1e1e1e (main), #252525 (panels), #2d2d2d (cards)
- Text: #dcddde (primary), #888888 (secondary)
- Borders: #3d3d3d
- Accent: #7c3aed (purple)

