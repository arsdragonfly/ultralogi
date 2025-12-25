# Contributing to Ultralogi

Thank you for your interest in contributing to Ultralogi! This document outlines the process for contributing.

## Contributor License Agreement (CLA)

**Before your contribution can be accepted, you must agree to our [Contributor License Agreement](CLA.md).**

When you open your first pull request, the CLA Assistant bot will automatically ask you to sign. Simply follow the bot's instructions to agree to the CLA terms.

### Why a CLA?

Ultralogi uses a dual-licensing model:
- **AGPL-3.0** for open source use
- **Commercial licenses** available for proprietary use

The CLA ensures we can continue offering both options by granting us the necessary rights to sublicense contributions.

## How to Contribute

### Reporting Issues

1. Check existing issues to avoid duplicates
2. Use a clear, descriptive title
3. Provide steps to reproduce (for bugs)
4. Include system information if relevant

### Submitting Code

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Ensure tests pass
5. Commit with clear messages
6. Push and open a pull request

### Code Style

- **Rust**: Run `cargo fmt` and `cargo clippy`
- **TypeScript**: Run `npm run lint`

### Commit Messages

Use clear, descriptive commit messages:
```
feat: add entity pathfinding system
fix: resolve DuckDB connection leak
docs: update README with new API
```

## Development Setup

```bash
# Install dependencies
npm install

# Build Rust module
cd ultralogi-rs && npm run build:debug && cd ..

# Start development
npm start
```

## Questions?

Open an issue or email arsdragonfly@gmail.com
