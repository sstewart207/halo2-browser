/** Resolve the legacy import spelling against actual PE DLL names. */
export function parseAotApiImport(name: string, dllNames: Iterable<string>): {dll: string; func: string} {
    const spelling = name.replace(/^win32_/, '');
    const candidates = [...dllNames].map(dll => dll.toLowerCase().replace(/\.dll$/, ''))
        .sort((a, b) => b.length - a.length);
    const dll = candidates.find(candidate => spelling.startsWith(`${candidate}_`));
    if (!dll) throw new Error(`AOT import has no matching PE DLL: ${name}`);
    return {dll, func: spelling.slice(dll.length + 1)};
}
