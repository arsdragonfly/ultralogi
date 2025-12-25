# Ultralogi

A Transport Tycoon-style logistics game built with modern web technologies.

## Tech Stack

- **Electron** - Desktop application framework
- **Use.GPU** (0.18.0) - WebGPU-powered reactive rendering
- **Rust + napi-rs** - High-performance native bindings with auto-generated TypeScript
- **DuckDB** (1.4.3) - In-process analytical database for game state
- **TypeScript** - Type-safe frontend development
- **Vite** - Fast build tooling

## Project Structure

```
ultralogi/
├── src/                    # TypeScript frontend
│   ├── App.tsx             # Main Use.GPU application
│   ├── Renderer.tsx        # Use.GPU render entry point
│   ├── Fallback.tsx        # WebGPU error fallback
│   ├── main.ts             # Electron main process
│   ├── preload.ts          # Electron preload (ultralogi-rs bridge)
│   └── types/
│       └── interface.d.ts  # Window global augmentation
├── ultralogi-rs/           # Rust native module
│   ├── Cargo.toml          # Rust dependencies
│   ├── src/lib.rs          # Rust code (DuckDB, game logic)
│   ├── index.d.ts          # Auto-generated TypeScript types (napi-rs)
│   ├── index.mjs           # ESM entry point
│   └── *.node              # Compiled native module (gitignored)
├── package.json            # Node.js dependencies
├── tsconfig.json           # TypeScript configuration
├── vite.*.config.ts        # Vite configurations
└── forge.config.ts         # Electron Forge configuration
```

## Development

### Prerequisites

- Node.js 20+
- Rust (stable)
- @napi-rs/cli

### Build Rust Module

```bash
cd ultralogi-rs
npm run build:debug    # Debug build
npm run build          # Release build
```

### Install Dependencies

```bash
npm install
```

### Run Development

```bash
npm start
```

### Available Rust APIs (via `window.ultralogi`)

| Function | Description |
|----------|-------------|
| `hello(name)` | Test function, returns greeting |
| `execute_sql(sql)` | Execute raw SQL, returns QueryResult |
| `query_json(sql)` | Query and return results as parsed JSON array |

## Architecture

### Rendering (Use.GPU)

Use.GPU provides a reactive, declarative approach to WebGPU rendering:
- Components re-render automatically when data changes
- Built-in UI layout system
- Pan/zoom camera controls
- Font rendering

### Game State (DuckDB)

DuckDB is used as an in-process analytical database:
- All game entities stored in SQL tables
- `threads=1` for low-latency queries (~40% faster for small queries)
- Batch operations for efficient updates
- SQL queries for complex game logic (pathfinding, etc.)

### Lua Mods (Future)

Lua scripting will be added for modding support:
- Batch query patterns (WHERE IN) for efficient entity access
- Transaction-wrapped batch updates
- Sandboxed execution environment

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) first.

We use the [SAP Individual CLA](https://gist.github.com/CLAassistant/bd1ea8ec8aa0357414e8) via CLA Assistant.

## License

AGPL-3.0 - see [LICENSE](LICENSE) for details.

For commercial licensing inquiries, contact arsdragonfly@gmail.com.
