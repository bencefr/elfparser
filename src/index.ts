import { readFileSync } from "fs";
import { inspect } from "util";
import { resolve_symbols } from "../lib/wasm/wasm_elf_parser";

// --- ENUMS & INTERFACES ---

export enum ElfClass {
    NONE = 0,
    ELF32 = 1,
    ELF64 = 2,
}
export enum ElfData {
    NONE = 0,
    LSB = 1,
    MSB = 2,
} // 1: Little Endian, 2: Big Endian

export const ELF_MACHINES: Record<number, string> = {
    0: "No machine",
    2: "SPARC",
    3: "x86",
    8: "MIPS",
    20: "PowerPC",
    40: "ARM",
    62: "x86-64",
    183: "AArch64",
    243: "RISC-V",
};

export const ELF_TYPES: Record<number, string> = {
    0: "ET_NONE (Unknown)",
    1: "ET_REL (Relocatable)",
    2: "ET_EXEC (Executable)",
    3: "ET_DYN (Shared object)",
    4: "ET_CORE (Core file)",
};

export const SECTION_TYPES: Record<number, string> = {
    0: "SHT_NULL",
    1: "SHT_PROGBITS",
    2: "SHT_SYMTAB",
    3: "SHT_STRTAB",
    4: "SHT_RELA",
    8: "SHT_NOBITS",
    9: "SHT_REL",
    11: "SHT_DYNSYM",
};

export interface ElfHeader {
    magic: string;
    bitClass: string;
    endianness: string;
    version: number;
    osAbi: number;
    abiVersion: number;
    type: string;
    machine: string;
    entryPoint: bigint;
    phOffset: bigint;
    shOffset: bigint;
    flags: number;
    headerSize: number;
    phEntrySize: number;
    phCount: number;
    shEntrySize: number;
    shCount: number;
    shStrIndex: number;
}

export interface ElfSection {
    index: number;
    name: string;
    type: string;
    flags: bigint;
    address: bigint;
    offset: bigint;
    size: bigint;
    link: number;
    info: number;
    addrAlign: bigint;
    entSize: bigint;
}

interface RawElfSymbol {
    index: number;
    name: string;
    value: bigint;
    size: bigint;
    binding: string;
    type: string;
    visibility: number;
    sectionIndex: number;
}

export interface ElfSymbol extends RawElfSymbol {
    file: string | undefined;
    line: number | undefined;
}

// --- PARSER CLASS ---

export class ElfParser {
    private view: DataView;
    private isLittleEndian: boolean = true;
    private is64Bit: boolean = true;
    private textDecoder = new TextDecoder("utf-8");

    public header!: ElfHeader;
    public sections: ElfSection[] = [];
    private sectionNamesSection!: ElfSection;

    constructor(private buffer: Uint8Array) {
        this.view = new DataView(buffer.buffer);
        this.validateAndParseHeader();
        this.parseSections();
    }

    private validateAndParseHeader() {
        // Verify Magic Number: 0x7F 'E' 'L' 'F'
        if (this.view.getUint32(0, false) !== 0x7f454c46) {
            throw new Error("Invalid ELF Magic Number");
        }

        const elfClass = this.view.getUint8(4);
        const elfData = this.view.getUint8(5);

        this.is64Bit = elfClass === Number(ElfClass.ELF64);
        this.isLittleEndian = elfData === Number(ElfData.LSB);

        const typeRaw = this.view.getUint16(16, this.isLittleEndian);
        const machineRaw = this.view.getUint16(18, this.isLittleEndian);

        // Header parsing handles the differing layouts of 32-bit vs 64-bit
        this.header = {
            magic: "7f 45 4c 46",
            bitClass: this.is64Bit ? "ELF64" : "ELF32",
            endianness: this.isLittleEndian
                ? "Little Endian (LSB)"
                : "Big Endian (MSB)",
            version: this.view.getUint8(6),
            osAbi: this.view.getUint8(7),
            abiVersion: this.view.getUint8(8),
            type: ELF_TYPES[typeRaw] || `Unknown (${typeRaw})`,
            machine: ELF_MACHINES[machineRaw] || `Unknown (${machineRaw})`,
            entryPoint: this.readPointer(24),
            phOffset: this.readPointer(this.is64Bit ? 32 : 28),
            shOffset: this.readPointer(this.is64Bit ? 40 : 32),
            flags: this.view.getUint32(
                this.is64Bit ? 48 : 36,
                this.isLittleEndian,
            ),
            headerSize: this.view.getUint16(
                this.is64Bit ? 52 : 40,
                this.isLittleEndian,
            ),
            phEntrySize: this.view.getUint16(
                this.is64Bit ? 54 : 42,
                this.isLittleEndian,
            ),
            phCount: this.view.getUint16(
                this.is64Bit ? 56 : 44,
                this.isLittleEndian,
            ),
            shEntrySize: this.view.getUint16(
                this.is64Bit ? 58 : 46,
                this.isLittleEndian,
            ),
            shCount: this.view.getUint16(
                this.is64Bit ? 60 : 48,
                this.isLittleEndian,
            ),
            shStrIndex: this.view.getUint16(
                this.is64Bit ? 62 : 50,
                this.isLittleEndian,
            ),
        };
    }

    private parseSections() {
        const shOffset = Number(this.header.shOffset);
        const shEntSize = this.header.shEntrySize;
        const shCount = this.header.shCount;

        // First pass: extract raw section data
        for (let i = 0; i < shCount; i++) {
            const offset = shOffset + i * shEntSize;
            const typeRaw = this.view.getUint32(
                offset + 4,
                this.isLittleEndian,
            );

            this.sections.push({
                index: i,
                name: "", // Will be resolved in second pass
                type: SECTION_TYPES[typeRaw] || `Unknown (${typeRaw})`,
                flags: this.readPointer(offset + 8),
                address: this.readPointer(offset + (this.is64Bit ? 16 : 12)),
                offset: this.readPointer(offset + (this.is64Bit ? 24 : 16)),
                size: this.readPointer(offset + (this.is64Bit ? 32 : 20)),
                link: this.view.getUint32(
                    offset + (this.is64Bit ? 40 : 24),
                    this.isLittleEndian,
                ),
                info: this.view.getUint32(
                    offset + (this.is64Bit ? 44 : 28),
                    this.isLittleEndian,
                ),
                addrAlign: this.readPointer(offset + (this.is64Bit ? 48 : 32)),
                entSize: this.readPointer(offset + (this.is64Bit ? 56 : 36)),
            });
        }

        // Second pass: resolve section names using the Section Header String Table (.shstrtab)
        if (
            this.header.shStrIndex !== 0 &&
            this.header.shStrIndex < this.sections.length
        ) {
            this.sectionNamesSection = this.sections[this.header.shStrIndex]!;
            const strTabOffset = Number(this.sectionNamesSection.offset);

            // Temporarily read raw names offset, then resolve them
            for (let i = 0; i < shCount; i++) {
                const nameOffset = this.view.getUint32(
                    shOffset + i * shEntSize,
                    this.isLittleEndian,
                );
                this.sections[i]!.name = this.readNullTerminatedString(
                    strTabOffset + nameOffset,
                );
            }
        }
    }

    private getRawSymbols(): RawElfSymbol[] {
        const symbols: RawElfSymbol[] = [];

        // Find Symbol Table (.symtab) and Dynamic Symbol Table (.dynsym)
        const symSections = this.sections.filter(
            (s) => s.type === "SHT_SYMTAB" || s.type === "SHT_DYNSYM",
        );

        for (const symSection of symSections) {
            // Find the associated string table for these symbols
            const strSection = this.sections[symSection.link]!;
            const strTabOffset = Number(strSection.offset);

            const symCount =
                Number(symSection.size) / Number(symSection.entSize);
            const symOffset = Number(symSection.offset);
            const entSize = Number(symSection.entSize);

            for (let i = 0; i < symCount; i++) {
                const entryOffset = symOffset + i * entSize;

                let nameOffset: number,
                    value: bigint,
                    size: bigint,
                    info: number,
                    other: number,
                    shndx: number;

                if (this.is64Bit) {
                    nameOffset = this.view.getUint32(
                        entryOffset,
                        this.isLittleEndian,
                    );
                    info = this.view.getUint8(entryOffset + 4);
                    other = this.view.getUint8(entryOffset + 5);
                    shndx = this.view.getUint16(
                        entryOffset + 6,
                        this.isLittleEndian,
                    );
                    value = this.view.getBigUint64(
                        entryOffset + 8,
                        this.isLittleEndian,
                    );
                    size = this.view.getBigUint64(
                        entryOffset + 16,
                        this.isLittleEndian,
                    );
                } else {
                    nameOffset = this.view.getUint32(
                        entryOffset,
                        this.isLittleEndian,
                    );
                    value = BigInt(
                        this.view.getUint32(
                            entryOffset + 4,
                            this.isLittleEndian,
                        ),
                    );
                    size = BigInt(
                        this.view.getUint32(
                            entryOffset + 8,
                            this.isLittleEndian,
                        ),
                    );
                    info = this.view.getUint8(entryOffset + 12);
                    other = this.view.getUint8(entryOffset + 13);
                    shndx = this.view.getUint16(
                        entryOffset + 14,
                        this.isLittleEndian,
                    );
                }

                // Decode symbol info
                const bindings = ["STB_LOCAL", "STB_GLOBAL", "STB_WEAK"];
                const types = [
                    "STT_NOTYPE",
                    "STT_OBJECT",
                    "STT_FUNC",
                    "STT_SECTION",
                    "STT_FILE",
                    "STT_COMMON",
                    "STT_TLS",
                ];

                const bindIdx = info >> 4;
                const typeIdx = info & 0xf;

                symbols.push({
                    index: i,
                    name: this.readNullTerminatedString(
                        strTabOffset + nameOffset,
                    ),
                    value,
                    size,
                    binding: bindings[bindIdx] || `Unknown (${bindIdx})`,
                    type: types[typeIdx] || `Unknown (${typeIdx})`,
                    visibility: other & 0x3,
                    sectionIndex: shndx,
                });
            }
        }
        return symbols;
    }

    public getSymbols(): ElfSymbol[] {
        const symbols = this.getRawSymbols();
        const addresses = symbols.map((symbol) => symbol.value);
        const resolvedSymbols: {
            file: string | undefined;
            line: number | undefined;
        }[] = resolve_symbols(this.buffer, BigUint64Array.from(addresses));
        return symbols.map((symbol, index) => ({
            ...symbol,
            ...resolvedSymbols[index],
        }));
    }

    // --- UTILITIES ---

    private readPointer(offset: number): bigint {
        if (this.is64Bit) {
            return this.view.getBigUint64(offset, this.isLittleEndian);
        } else {
            return BigInt(this.view.getUint32(offset, this.isLittleEndian));
        }
    }

    private readNullTerminatedString(offset: number): string {
        let end = offset;
        while (end < this.buffer.byteLength && this.view.getUint8(end) !== 0) {
            end++;
        }
        const stringBytes = new Uint8Array(
            this.buffer.buffer,
            offset,
            end - offset,
        );
        return this.textDecoder.decode(stringBytes);
    }
}
