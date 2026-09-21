# ELF Parser

A TypeScript library for parsing ELF binaries and resolving DWARF line information for symbol addresses.

## Features

- Parse ELF headers, sections, and symbol tables
- Resolve machine and type metadata from ELF headers
- Map symbol addresses back to source file and line numbers using DWARF data
- Expose a Node-friendly TypeScript API
- Build a Rust-backed WebAssembly implementation for fast symbol lookup

## Project layout

- `src/index.ts` - TypeScript entry point for the package
- `lib/` - generated JavaScript and declaration output
- `wasm-elf-parser/` - Rust crate that produces the WebAssembly parser
- `.github/workflows/build.yml` - CI build workflow

## Prerequisites

- Node.js 22+
- Rust toolchain with `wasm32-unknown-unknown` target
- `wasm-bindgen-cli`

## Install

```bash
npm install
```

This installs the required Rust tooling and WASM target when needed.

## Build

```bash
npm run build
```

The build does the following:

1. Compiles the Rust WASM library
2. Generates JavaScript and TypeScript bindings with `wasm-bindgen`
3. Compiles the TypeScript package into `lib/`

## Package usage

After building, the package entry point is:

```js
const { ElfParser } = require("elfparser");
```

or in TypeScript:

```ts
import { ElfParser } from "elfparser";
```

## Example

```ts
import { readFileSync } from "node:fs";
import { ElfParser } from "elfparser";

const file = readFileSync("path/to/binary");
const parser = new ElfParser(file);

console.log(parser.header);
console.log(parser.getSymbols());
```

## License

ISC
