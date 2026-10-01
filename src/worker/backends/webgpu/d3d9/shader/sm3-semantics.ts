import type { SmProgram, SmRegister } from './sm-parser';
import { RegType, RASTOUT_POS } from './sm-enums';

/** SM3 interpolator numbers are arbitrary: dcl semantics connect VS outputs to PS
 * inputs. Normalize supported semantics into the existing semantic register IR,
 * preserving instruction masks/swizzles/modifiers and shader version.
 * https://learn.microsoft.com/en-us/windows/win32/direct3dhlsl/dcl-usage---ps
 */
export function normalizeSm3Semantics(program: SmProgram): SmProgram {
    if (program.major < 3) return program;
    const mappings = new Map<number, { type: RegType; num: number }>();
    const sourceType = program.isPixelShader ? RegType.INPUT : RegType.OUTPUT;
    for (const declaration of program.declarations) {
        if (declaration.reg.type !== sourceType) continue;
        if (mappings.has(declaration.reg.num)) {
            throw new Error(`Packed SM3 semantics in register ${declaration.reg.num} are unsupported`);
        }
        const { usage, usageIndex } = declaration;
        if (usage === 5) mappings.set(declaration.reg.num, {
            type: program.isPixelShader ? RegType.TEXTURE : RegType.TEXCRDOUT, num: usageIndex,
        });
        else if (usage === 10 && usageIndex < 2) mappings.set(declaration.reg.num, {
            type: program.isPixelShader ? RegType.INPUT : RegType.ATTROUT, num: usageIndex,
        });
        else if (!program.isPixelShader && usage === 0 && usageIndex === 0) {
            mappings.set(declaration.reg.num, { type: RegType.RASTOUT, num: RASTOUT_POS });
        } else throw new Error(`Unsupported SM3 ${program.isPixelShader ? 'input' : 'output'} semantic ${usage}:${usageIndex}`);
    }
    const mapRegister = (register: SmRegister): SmRegister => {
        if (register.type !== sourceType) return register;
        const mapping = mappings.get(register.num);
        if (!mapping) throw new Error(`SM3 register ${register.num} lacks a semantic declaration`);
        return { ...register, ...mapping };
    };
    return { ...program, declarations: program.declarations.map(d => ({ ...d, reg: mapRegister(d.reg) })),
        instructions: program.instructions.map(instruction => ({ ...instruction,
            dst: instruction.dst ? { ...instruction.dst, reg: mapRegister(instruction.dst.reg) } : null,
            src: instruction.src.map(source => ({ ...source, reg: mapRegister(source.reg) })),
        })) };
}
