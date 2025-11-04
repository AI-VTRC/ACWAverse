# Repository Guidelines

## Project Structure & Module Organization
- `src/acwa-engine.js` holds the pure simulation engine exposed as `window.ACWAEngine`; keep new logic modular and data-driven.
- `src/acwa-logic.js` orchestrates runs, conditional rules, and attack scheduling between the engine and UI.
- `src/acwa.js`, `src/index.html`, and `src/style.css` power the browser visualizer; guard UI-only helpers from leaking into the engine.
- Scenario fixtures reside in `src/data/` with `manifest.json` listing available networks; add new JSON files there and reference them in the manifest.
- Research collateral, figures, and the LaTeX paper live under `paper/`; update `paper/main.tex` and supporting assets together.

## Build, Test, and Development Commands
- `node src/tests/run-node-tests.js` runs the Node-based regression suite with the engine sandboxed via `vm`.
- `python -m http.server 8000 --directory src` serves the UI for manual verification; any static file server rooted at `src/` is acceptable.
- `node --watch src/tests/run-node-tests.js` (Node ≥20) reruns the suite on save during iterative development.

## Coding Style & Naming Conventions
- Use 2-space indentation, `const`/`let` instead of `var`, and camelCase for JavaScript identifiers; component ids may remain snake_case to match JSON fixtures.
- Keep engine modules free of DOM dependencies; browser-specific helpers belong in `acwa.js`.
- Document exported helpers with concise comments when behavior is not obvious, and attach engine APIs to `window.ACWAEngine` consistently.

## Testing Guidelines
- Extend `src/tests/run-node-tests.js` with the inline `test('name', fn)` helper and Node's `assert`; prefer deterministic fixture builders over shared state.
- Cover edge cases for valve controls, attack effects, and geometric calculations before merging.
- When adding scenarios to `src/data/`, craft a dedicated factory in tests (e.g., `makeTiny`) to isolate assumptions.

## Commit & Pull Request Guidelines
- Write imperative commit subjects under ~72 characters (e.g., `Add leak damage regression test`) and group related changes.
- Reference touched scenario files or engine APIs in commit bodies so reviewers can trace impact.
- Pull requests must describe behavior changes, note any manual verification (commands above), and include screenshots for UI adjustments.
