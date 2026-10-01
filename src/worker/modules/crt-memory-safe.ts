/** Microsoft CRT memcpy_s parameter validation and copy semantics. */
export interface SafeCopyHost {
    copy(destination: number, source: number, count: number): void;
    clear(destination: number, size: number): void;
    invalidParameter(code: number): void;
}

export function memcpySafe(host: SafeCopyHost, destination: number, size: number, source: number, count: number): number {
    destination >>>= 0;
    size >>>= 0;
    source >>>= 0;
    count >>>= 0;
    if (count === 0) return 0;
    if (!destination) {
        host.invalidParameter(22); // EINVAL
        return 22;
    }
    if (!source || size < count) {
        host.clear(destination, size);
        const code = !source ? 22 : 34; // EINVAL / ERANGE
        host.invalidParameter(code);
        return code;
    }
    host.copy(destination, source, count);
    return 0;
}
