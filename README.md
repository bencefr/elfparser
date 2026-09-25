[![Build](https://github.com/bencefr/elfparser/actions/workflows/build.yml/badge.svg)](https://github.com/bencefr/elfparser/actions/workflows/build.yml)

# ELF Parser

A TypeScript library for parsing ELF binaries and resolving DWARF line information for symbol addresses.

## Features

- Parse ELF headers, sections, and symbol tables
- Resolve machine and type metadata from ELF headers
- Map symbol addresses back to source file and line numbers using DWARF data
- Expose a Node-friendly TypeScript API
- Build a Rust-backed WebAssembly implementation for fast symbol lookup

## Prerequisites

- Node.js 22+

## Install

```bash
npm install
```

The published package includes the generated WASM files, so installing it does not require Rust.

## Build prerequisites

Building the WASM implementation from source requires:

- Rust toolchain with the `wasm32-unknown-unknown` target
- `wasm-bindgen-cli`

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

## Unnamed symbols

`getSymbols()` includes all entries from the ELF symbol tables, including
entries without a name. These entries can still be useful when inspecting ELF
metadata:

- The first entry is the mandatory ELF null symbol. It has no name and a zero
  value.
- Unnamed `STT_SECTION` entries identify sections and can be useful for
  low-level inspection, relocation, or debugging.

For application-level symbol lookup, filter out unnamed entries. To find
functions, filter by symbol type as well:

```ts
const namedSymbols = parser.getSymbols().filter((symbol) => symbol.name !== "");

const functions = parser
    .getSymbols()
    .filter(
        (symbol) =>
            symbol.name !== "" &&
            (symbol.type === "STT_FUNC" || symbol.type === "STT_NOTYPE"),
    );
```

## License

Apache License 2.0
