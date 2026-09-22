const { readFileSync } = require("node:fs");
const { ElfParser } = require("../lib/index.js");

describe("ElfParser", () => {
    const realFile = readFileSync("tests/zephyr.elf");

    test("rejects invalid ELF magic", () => {
        const buffer = new Uint8Array([0x00, 0x00, 0x00, 0x00]);
        expect(() => new ElfParser(buffer)).toThrow("Invalid ELF Magic Number");
    });

    test("parses the real Zephyr ELF fixture", () => {
        const parser = new ElfParser(realFile);

        expect(parser.header.magic).toBe("7f 45 4c 46");
        expect(parser.header.bitClass).toBe("ELF32");
        expect(parser.header.endianness).toBe("Little Endian (LSB)");
        expect(parser.header.machine).toBe("RISC-V");
        expect(parser.sections.length).toBeGreaterThan(0);
        expect(parser.sections.some((section) => section.name === "text")).toBe(
            true,
        );
    });

    test("lists init-level functions between __init_EARLY_start and __init_end", () => {
        const parser = new ElfParser(realFile);
        const symbols = parser.getSymbols();

        const start = symbols.find(
            (symbol) => symbol.name === "__init_EARLY_start",
        );
        const end = symbols.find((symbol) => symbol.name === "__init_end");

        expect(start).toBeDefined();
        expect(end).toBeDefined();

        const initLevelSymbols = symbols.filter(
            (symbol) =>
                symbol.value >= start.value && symbol.value <= end.value,
        );

        expect(initLevelSymbols.length).toBeGreaterThan(0);
        expect(
            initLevelSymbols.some(
                (symbol) => symbol.name === "__init_enable_logger",
            ),
        ).toBe(true);
        expect(
            initLevelSymbols.some(
                (symbol) => symbol.name === "__init_vpr_init",
            ),
        ).toBe(true);
        expect(
            initLevelSymbols.some(
                (symbol) => symbol.name === "__init_SMP_start",
            ),
        ).toBe(true);
        expect(
            initLevelSymbols.some((symbol) => symbol.name === "__init_end"),
        ).toBe(true);
        expect(
            initLevelSymbols.some(
                (symbol) => symbol.name === "__init_EARLY_start",
            ),
        ).toBe(true);
    });
});
