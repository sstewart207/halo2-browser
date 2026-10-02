/**
 * wasm-builder.ts — Low-overhead WebAssembly module builder (WAT and binary WASM emitter).
 */

export function encodeULEB128(val: number): number[] {
    const bytes: number[] = [];
    val = val >>> 0;
    do {
        let b = val & 0x7f;
        val >>>= 7;
        if (val !== 0) b |= 0x80;
        bytes.push(b);
    } while (val !== 0);
    return bytes;
}

export function encodeSLEB128(val: number): number[] {
    const bytes: number[] = [];
    val = val | 0; // force 32-bit signed
    let more = true;
    while (more) {
        let b = val & 0x7f;
        val >>= 7;
        if ((val === 0 && (b & 0x40) === 0) || (val === -1 && (b & 0x40) !== 0)) {
            more = false;
        } else {
            b |= 0x80;
        }
        bytes.push(b);
    }
    return bytes;
}

export function encodeString(str: string): number[] {
    const buf = Buffer.from(str, 'utf8');
    return [...encodeULEB128(buf.length), ...buf];
}

export class ByteWriter {
    chunks: Uint8Array[] = [];
    totalLength = 0;

    write(bytes: ArrayLike<number> | Uint8Array) {
        const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        if (u8.length === 0) return;
        this.chunks.push(u8);
        this.totalLength += u8.length;
    }

    toUint8Array(): Uint8Array {
        const out = new Uint8Array(this.totalLength);
        let offset = 0;
        for (const chunk of this.chunks) {
            out.set(chunk, offset);
            offset += chunk.length;
        }
        return out;
    }
}

export function createSection(id: number, payload: Uint8Array | number[]): Uint8Array {
    const len = payload.length;
    const lenBytes = encodeULEB128(len);
    const header = new Uint8Array(1 + lenBytes.length);
    header[0] = id;
    header.set(lenBytes, 1);

    const out = new Uint8Array(header.length + len);
    out.set(header, 0);
    out.set(payload instanceof Uint8Array ? payload : new Uint8Array(payload), header.length);
    return out;
}

export interface WasmFuncSignature {
    params: number[]; // 0x7F for i32
    results: number[]; // 0x7F for i32
}

export class WasmFunctionBuilder {
    name: string;
    sigIndex: number;
    locals: number[] = []; // count of i32 locals
    bytecode: number[] = [];
    watLines: string[] = [];

    constructor(name: string, sigIndex: number) {
        this.name = name;
        this.sigIndex = sigIndex;
    }

    addLocals(count: number, type: number = 0x7f) {
        this.locals.push(count, type);
    }

    // Guest addresses stay guest-relative in registers; translate only at loads/stores.
    guestMemoryBaseGlobal?: number;
    guestStoreI32Local?: number;
    guestStoreF32Local?: number;

    private translateGuestAddress() {
        if (this.guestMemoryBaseGlobal !== undefined) {
            this.global_get(this.guestMemoryBaseGlobal);
            this.i32_add();
        }
    }

    private translateGuestStore(float: boolean = false) {
        if (this.guestMemoryBaseGlobal === undefined) return;
        const scratch = float ? this.guestStoreF32Local : this.guestStoreI32Local;
        if (scratch === undefined) throw new Error('Guest memory store scratch local missing');
        this.local_set(scratch);
        this.translateGuestAddress();
        this.local_get(scratch);
    }

    // --- WASM Opcodes ---

    emitByte(b: number) {
        this.bytecode.push(b);
    }

    emitBytes(bytes: number[]) {
        this.bytecode.push(...bytes);
    }

    // Constants & Variables
    i32_const(val: number, watComment?: string) {
        this.emitByte(0x41);
        this.emitBytes(encodeSLEB128(val));
        this.watLines.push(`    i32.const ${val}${watComment ? ` ;; ${watComment}` : ''}`);
    }

    local_get(idx: number, name?: string) {
        this.emitByte(0x20);
        this.emitBytes(encodeULEB128(idx));
        this.watLines.push(`    local.get ${idx}${name ? ` ;; ${name}` : ''}`);
    }

    local_set(idx: number, name?: string) {
        this.emitByte(0x21);
        this.emitBytes(encodeULEB128(idx));
        this.watLines.push(`    local.set ${idx}${name ? ` ;; ${name}` : ''}`);
    }

    local_tee(idx: number, name?: string) {
        this.emitByte(0x22);
        this.emitBytes(encodeULEB128(idx));
        this.watLines.push(`    local.tee ${idx}${name ? ` ;; ${name}` : ''}`);
    }

    global_get(idx: number, name?: string) {
        this.emitByte(0x23);
        this.emitBytes(encodeULEB128(idx));
        this.watLines.push(`    global.get ${idx}${name ? ` ;; ${name}` : ''}`);
    }

    global_set(idx: number, name?: string) {
        this.emitByte(0x24);
        this.emitBytes(encodeULEB128(idx));
        this.watLines.push(`    global.set ${idx}${name ? ` ;; ${name}` : ''}`);
    }

    // Memory Load / Store
    i32_load(offset: number = 0, align: number = 2) {
        this.translateGuestAddress();
        this.emitByte(0x28);
        this.emitBytes(encodeULEB128(align));
        this.emitBytes(encodeULEB128(offset));
        this.watLines.push(`    i32.load offset=${offset}`);
    }

    i32_load8_u(offset: number = 0, align: number = 0) {
        this.translateGuestAddress();
        this.emitByte(0x2D);
        this.emitBytes(encodeULEB128(align));
        this.emitBytes(encodeULEB128(offset));
        this.watLines.push(`    i32.load8_u offset=${offset}`);
    }

    i32_load8_s(offset: number = 0, align: number = 0) {
        this.translateGuestAddress();
        this.emitByte(0x2C);
        this.emitBytes(encodeULEB128(align));
        this.emitBytes(encodeULEB128(offset));
        this.watLines.push(`    i32.load8_s offset=${offset}`);
    }

    i32_load16_u(offset: number = 0, align: number = 1) {
        this.translateGuestAddress();
        this.emitByte(0x2F);
        this.emitBytes(encodeULEB128(align));
        this.emitBytes(encodeULEB128(offset));
        this.watLines.push(`    i32.load16_u offset=${offset}`);
    }

    i32_load16_s(offset: number = 0, align: number = 1) {
        this.translateGuestAddress();
        this.emitByte(0x2E);
        this.emitBytes(encodeULEB128(align));
        this.emitBytes(encodeULEB128(offset));
        this.watLines.push(`    i32.load16_s offset=${offset}`);
    }

    i32_store(offset: number = 0, align: number = 2) {
        this.translateGuestStore(false);
        this.emitByte(0x36);
        this.emitBytes(encodeULEB128(align));
        this.emitBytes(encodeULEB128(offset));
        this.watLines.push(`    i32.store offset=${offset}`);
    }

    i32_store8(offset: number = 0, align: number = 0) {
        this.translateGuestStore(false);
        this.emitByte(0x3A);
        this.emitBytes(encodeULEB128(align));
        this.emitBytes(encodeULEB128(offset));
        this.watLines.push(`    i32.store8 offset=${offset}`);
    }

    i32_store16(offset: number = 0, align: number = 1) {
        this.translateGuestStore(false);
        this.emitByte(0x3B);
        this.emitBytes(encodeULEB128(align));
        this.emitBytes(encodeULEB128(offset));
        this.watLines.push(`    i32.store16 offset=${offset}`);
    }

    // Arithmetic & Logic
    i32_add() { this.emitByte(0x6A); this.watLines.push('    i32.add'); }
    i32_sub() { this.emitByte(0x6B); this.watLines.push('    i32.sub'); }
    i32_mul() { this.emitByte(0x6C); this.watLines.push('    i32.mul'); }
    i32_div_s() { this.emitByte(0x6D); this.watLines.push('    i32.div_s'); }
    i32_div_u() { this.emitByte(0x6E); this.watLines.push('    i32.div_u'); }
    i32_and() { this.emitByte(0x71); this.watLines.push('    i32.and'); }
    i32_or() { this.emitByte(0x72); this.watLines.push('    i32.or'); }
    i32_xor() { this.emitByte(0x73); this.watLines.push('    i32.xor'); }
    i32_shl() { this.emitByte(0x74); this.watLines.push('    i32.shl'); }
    i32_shr_s() { this.emitByte(0x75); this.watLines.push('    i32.shr_s'); }
    i32_shr_u() { this.emitByte(0x76); this.watLines.push('    i32.shr_u'); }
    i32_rotl() { this.emitByte(0x77); this.watLines.push('    i32.rotl'); }
    i32_rotr() { this.emitByte(0x78); this.watLines.push('    i32.rotr'); }
    i32_rem_s() { this.emitByte(0x6F); this.watLines.push('    i32.rem_s'); }
    i32_rem_u() { this.emitByte(0x70); this.watLines.push('    i32.rem_u'); }

    // Floating-Point (f32)
    f32_const(val: number) {
        this.emitByte(0x43);
        const buf = Buffer.alloc(4);
        buf.writeFloatLE(val, 0);
        this.emitBytes([...buf]);
        this.watLines.push(`    f32.const ${val}`);
    }
    f32_load(offset: number = 0, align: number = 2) {
        this.translateGuestAddress();
        this.emitByte(0x2A);
        this.emitBytes(encodeULEB128(align));
        this.emitBytes(encodeULEB128(offset));
        this.watLines.push(`    f32.load offset=${offset}`);
    }
    f32_store(offset: number = 0, align: number = 2) {
        this.translateGuestStore(true);
        this.emitByte(0x38);
        this.emitBytes(encodeULEB128(align));
        this.emitBytes(encodeULEB128(offset));
        this.watLines.push(`    f32.store offset=${offset}`);
    }
    f32_add() { this.emitByte(0x92); this.watLines.push('    f32.add'); }
    f32_sub() { this.emitByte(0x93); this.watLines.push('    f32.sub'); }
    f32_mul() { this.emitByte(0x94); this.watLines.push('    f32.mul'); }
    f32_div() { this.emitByte(0x95); this.watLines.push('    f32.div'); }
    f32_eq() { this.emitByte(0x5B); this.watLines.push('    f32.eq'); }
    f32_ne() { this.emitByte(0x5C); this.watLines.push('    f32.ne'); }
    f32_lt() { this.emitByte(0x5D); this.watLines.push('    f32.lt'); }
    f32_gt() { this.emitByte(0x5E); this.watLines.push('    f32.gt'); }
    f32_le() { this.emitByte(0x5F); this.watLines.push('    f32.le'); }
    f32_ge() { this.emitByte(0x60); this.watLines.push('    f32.ge'); }
    f32_convert_i32_s() { this.emitByte(0xB2); this.watLines.push('    f32.convert_i32_s'); }
    i32_trunc_f32_s() { this.emitByte(0xA8); this.watLines.push('    i32.trunc_f32_s'); }
    i32_reinterpret_f32() { this.emitByte(0xBC); this.watLines.push('    i32.reinterpret_f32'); }
    f32_reinterpret_i32() { this.emitByte(0xBE); this.watLines.push('    f32.reinterpret_i32'); }

    // Comparisons
    i32_eqz() { this.emitByte(0x45); this.watLines.push('    i32.eqz'); }
    i32_eq() { this.emitByte(0x46); this.watLines.push('    i32.eq'); }
    i32_ne() { this.emitByte(0x47); this.watLines.push('    i32.ne'); }
    i32_lt_s() { this.emitByte(0x48); this.watLines.push('    i32.lt_s'); }
    i32_lt_u() { this.emitByte(0x49); this.watLines.push('    i32.lt_u'); }
    i32_gt_s() { this.emitByte(0x4A); this.watLines.push('    i32.gt_s'); }
    i32_gt_u() { this.emitByte(0x4B); this.watLines.push('    i32.gt_u'); }
    i32_le_s() { this.emitByte(0x4C); this.watLines.push('    i32.le_s'); }
    i32_le_u() { this.emitByte(0x4D); this.watLines.push('    i32.le_u'); }
    i32_ge_s() { this.emitByte(0x4E); this.watLines.push('    i32.ge_s'); }
    i32_ge_u() { this.emitByte(0x4F); this.watLines.push('    i32.ge_u'); }

    // Control Flow
    block(type: number = 0x40, label?: string) {
        this.emitByte(0x02);
        this.emitByte(type);
        this.watLines.push(`    block ${label ?? ''}`);
    }

    loop(type: number = 0x40, label?: string) {
        this.emitByte(0x03);
        this.emitByte(type);
        this.watLines.push(`    loop ${label ?? ''}`);
    }

    if_block(type: number = 0x40) {
        this.emitByte(0x04);
        this.emitByte(type);
        this.watLines.push('    if');
    }

    else_block() {
        this.emitByte(0x05);
        this.watLines.push('    else');
    }

    end(watComment?: string) {
        this.emitByte(0x0B);
        this.watLines.push(`    end${watComment ? ` ;; ${watComment}` : ''}`);
    }

    br(depth: number, watLabel?: string) {
        this.emitByte(0x0C);
        this.emitBytes(encodeULEB128(depth));
        this.watLines.push(`    br ${depth}${watLabel ? ` ;; ${watLabel}` : ''}`);
    }

    br_if(depth: number, watLabel?: string) {
        this.emitByte(0x0D);
        this.emitBytes(encodeULEB128(depth));
        this.watLines.push(`    br_if ${depth}${watLabel ? ` ;; ${watLabel}` : ''}`);
    }

    br_table(labels: number[], defaultLabel: number) {
        this.emitByte(0x0E);
        this.emitBytes(encodeULEB128(labels.length));
        for (const l of labels) {
            this.emitBytes(encodeULEB128(l));
        }
        this.emitBytes(encodeULEB128(defaultLabel));
        this.watLines.push(`    br_table ${labels.join(' ')} ${defaultLabel}`);
    }

    return_op() {
        this.emitByte(0x0F);
        this.watLines.push('    return');
    }

    call_func(funcIdx: number, funcName?: string) {
        this.emitByte(0x10);
        this.emitBytes(encodeULEB128(funcIdx));
        this.watLines.push(`    call ${funcIdx}${funcName ? ` ;; ${funcName}` : ''}`);
    }

    drop() {
        this.emitByte(0x1A);
        this.watLines.push('    drop');
    }

    nop() {
        this.emitByte(0x01);
        this.watLines.push('    nop');
    }

    comment(text: string) {
        this.watLines.push(`    ;; ${text}`);
    }

    buildCodeBody(): Uint8Array {
        // Locals: vector of [count, type]
        const localsCount = this.locals.length / 2;
        const localBytes = [...encodeULEB128(localsCount), ...this.locals];
        const bodyLength = localBytes.length + this.bytecode.length + 1; // +1 for 0x0B
        const lenBytes = encodeULEB128(bodyLength);

        const out = new Uint8Array(lenBytes.length + bodyLength);
        out.set(lenBytes, 0);
        out.set(localBytes, lenBytes.length);
        out.set(this.bytecode, lenBytes.length + localBytes.length);
        out[out.length - 1] = 0x0B;
        return out;
    }
}

export class WasmModuleBuilder {
    signatures: WasmFuncSignature[] = [];
    functions: WasmFunctionBuilder[] = [];
    functionImports: Array<{ module: string; field: string; typeIdx: number; name?: string }> = [];
    exports: { name: string; kind: number; index: number }[] = [];
    globals: Array<{ type: number; mut: number; initVal: number }> = [];
    memoryPages: number = 16;
    importMemory: boolean = false;
    exportMemory: boolean = true;

    addGlobal(type: number = 0x7f, mut: number = 1, initVal: number = 0): number {
        const idx = this.globals.length;
        this.globals.push({ type, mut, initVal });
        return idx;
    }

    addSignature(params: number[], results: number[]): number {
        // Find existing matching signature
        for (let i = 0; i < this.signatures.length; i++) {
            const s = this.signatures[i];
            if (s.params.length === params.length && s.results.length === results.length) {
                const matchParams = s.params.every((p, idx) => p === params[idx]);
                const matchResults = s.results.every((r, idx) => r === results[idx]);
                if (matchParams && matchResults) return i;
            }
        }
        const idx = this.signatures.length;
        this.signatures.push({ params, results });
        return idx;
    }

    addFunctionImport(module: string, field: string, typeIdx: number, name?: string): number {
        const idx = this.functionImports.length;
        this.functionImports.push({ module, field, typeIdx, name });
        return idx;
    }

    getLocalFunctionIndex(localIdx: number): number {
        return this.functionImports.length + localIdx;
    }

    addFunction(name: string, sigIndex: number): WasmFunctionBuilder {
        const fn = new WasmFunctionBuilder(name, sigIndex);
        this.functions.push(fn);
        return fn;
    }

    addExport(name: string, kind: number, index: number) {
        this.exports.push({ name, kind, index });
    }

    toBinary(): Uint8Array {
        const writer = new ByteWriter();

        // Header: \0asm + version 1
        writer.write(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));

        // 1. Type Section (ID 1)
        const typePayload: number[] = [...encodeULEB128(this.signatures.length)];
        for (const sig of this.signatures) {
            typePayload.push(0x60); // func type
            typePayload.push(...encodeULEB128(sig.params.length), ...sig.params);
            typePayload.push(...encodeULEB128(sig.results.length), ...sig.results);
        }
        writer.write(createSection(1, typePayload));

        // 2. Import Section (ID 2)
        const totalImports = (this.importMemory ? 1 : 0) + this.functionImports.length;
        if (totalImports > 0) {
            const importPayload: number[] = [...encodeULEB128(totalImports)];
            if (this.importMemory) {
                importPayload.push(
                    ...encodeString('env'),
                    ...encodeString('memory'),
                    0x02, // memory import
                    0x00, // flags: min only
                    ...encodeULEB128(this.memoryPages)
                );
            }
            for (const fi of this.functionImports) {
                importPayload.push(
                    ...encodeString(fi.module),
                    ...encodeString(fi.field),
                    0x00, // func import
                    ...encodeULEB128(fi.typeIdx)
                );
            }
            writer.write(createSection(2, importPayload));
        }

        // 3. Function Section (ID 3)
        const funcPayload: number[] = [...encodeULEB128(this.functions.length)];
        for (const fn of this.functions) {
            funcPayload.push(...encodeULEB128(fn.sigIndex));
        }
        writer.write(createSection(3, funcPayload));

        // 5. Memory Section (ID 5) - only if memory is not imported
        if (!this.importMemory) {
            const memPayload: number[] = [
                1, // 1 memory
                0x00, // flags: min only
                ...encodeULEB128(this.memoryPages)
            ];
            writer.write(createSection(5, memPayload));
        }

        // 6. Global Section (ID 6)
        if (this.globals.length > 0) {
            const globalPayload: number[] = [...encodeULEB128(this.globals.length)];
            for (const g of this.globals) {
                globalPayload.push(g.type, g.mut);
                // init expr: i32.const <initVal> end
                globalPayload.push(0x41, ...encodeSLEB128(g.initVal), 0x0B);
            }
            writer.write(createSection(6, globalPayload));
        }

        // 7. Export Section (ID 7)
        const exportPayload: number[] = [];
        let exportCount = this.exports.length + (this.exportMemory ? 1 : 0);
        exportPayload.push(...encodeULEB128(exportCount));

        if (this.exportMemory) {
            exportPayload.push(...encodeString('memory'), 0x02, 0x00); // export memory index 0
        }

        for (const exp of this.exports) {
            const funcIdx = exp.kind === 0 ? (exp.index + this.functionImports.length) : exp.index;
            exportPayload.push(...encodeString(exp.name), exp.kind, ...encodeULEB128(funcIdx));
        }
        writer.write(createSection(7, exportPayload));

        // 10. Code Section (ID 10) - streamed via ByteWriter to avoid call-stack limits
        const codeWriter = new ByteWriter();
        codeWriter.write(encodeULEB128(this.functions.length));
        for (const fn of this.functions) {
            codeWriter.write(fn.buildCodeBody());
        }
        writer.write(createSection(10, codeWriter.toUint8Array()));

        return writer.toUint8Array();
    }

    toWat(): string {
        const lines: string[] = ['(module'];

        if (this.importMemory) {
            lines.push(`  (import "env" "memory" (memory ${this.memoryPages}))`);
        } else {
            lines.push(`  (memory (export "memory") ${this.memoryPages})`);
        }

        for (let i = 0; i < this.functionImports.length; i++) {
            const fi = this.functionImports[i];
            const sig = this.signatures[fi.typeIdx];
            const params = sig.params.map((_, idx) => `(param $p${idx} i32)`).join(' ');
            const results = sig.results.map(() => '(result i32)').join(' ');
            lines.push(`  (import "${fi.module}" "${fi.field}" (func $${fi.name || `import_${i}`} ${params} ${results}))`);
        }

        for (let i = 0; i < this.functions.length; i++) {
            const fn = this.functions[i];
            const sig = this.signatures[fn.sigIndex];
            const params = sig.params.map((_, idx) => `(param $p${idx} i32)`).join(' ');
            const results = sig.results.map(() => '(result i32)').join(' ');
            const exp = this.exports.find(e => e.kind === 0 && e.index === i);

            let fnHeader = `  (func $${fn.name}`;
            if (exp) fnHeader += ` (export "${exp.name}")`;
            if (params) fnHeader += ` ${params}`;
            if (results) fnHeader += ` ${results}`;

            lines.push(fnHeader);
            if (fn.locals.length > 0) {
                let localCount = 0;
                for (let j = 0; j < fn.locals.length; j += 2) {
                    localCount += fn.locals[j];
                }
                lines.push(`    (local ${Array(localCount).fill('i32').join(' ')})`);
            }
            lines.push(...fn.watLines);
            lines.push('  )');
        }

        lines.push(')');
        return lines.join('\n');
    }
}
