/**
 * Canonical thunked DLL name resolution.
 * Versioned or wrapper DLL names map to a single HLE module.
 */

const STATIC_ALIASES: Record<string, string> = {
    xdd: "ddraw",
    ddraw32: "ddraw",
    dinput8: "dinput",
    openal32: "wrap_oal",
};

// API-set DLLs are contracts, resolved to the runtime's semantic HLE host.
// Keep explicit contracts: unknown namespaces must not silently become kernel32.
const API_SET_HOSTS: Record<string, string> = {
    'api-ms-win-core-libraryloader-l1-2-0': 'kernel32',
    'api-ms-win-core-synch-l1-1-0': 'kernel32',
    'api-ms-win-core-synch-l1-2-0': 'kernel32',
    'api-ms-win-core-heap-l1-1-0': 'kernel32',
    'api-ms-win-core-heap-l2-1-0': 'kernel32',
    'api-ms-win-core-errorhandling-l1-1-0': 'kernel32',
    'api-ms-win-core-threadpool-l1-2-0': 'kernel32',
    'api-ms-win-core-processthreads-l1-1-0': 'kernel32',
    'api-ms-win-core-processthreads-l1-1-1': 'kernel32',
    'api-ms-win-core-localization-l1-2-0': 'kernel32',
    'api-ms-win-core-debug-l1-1-0': 'kernel32',
    'api-ms-win-core-handle-l1-1-0': 'kernel32',
    'api-ms-win-core-profile-l1-1-0': 'kernel32',
    'api-ms-win-core-sysinfo-l1-1-0': 'kernel32',
    'api-ms-win-core-memory-l1-1-0': 'kernel32',
    'api-ms-win-core-string-l1-1-0': 'kernel32',
    'api-ms-win-core-timezone-l1-1-0': 'kernel32',
    'api-ms-win-core-datetime-l1-1-0': 'kernel32',
    'api-ms-win-core-file-l1-1-0': 'kernel32',
    'api-ms-win-core-file-l1-2-0': 'kernel32',
    'api-ms-win-core-com-l1-1-0': 'ole32',
    'api-ms-win-core-string-l2-1-0': 'user32',
    'api-ms-win-core-registry-l1-1-0': 'advapi32',
    'api-ms-win-security-base-l1-1-0': 'advapi32',
    'api-ms-win-core-rtlsupport-l1-1-0': 'ntdll',
    'api-ms-win-core-shlwapi-legacy-l1-1-0': 'shlwapi',
    'api-ms-win-core-shlwapi-obsolete-l1-1-0': 'shlwapi',
    'api-ms-win-core-url-l1-1-0': 'shlwapi',
    'api-ms-win-core-delayload-l1-1-1': 'kernel32',
    'api-ms-win-core-delayload-l1-1-0': 'kernel32',
    'api-ms-win-core-apiquery-l1-1-0': 'kernel32',
    'ext-ms-win-ole32-bindctx-l1-1-0': 'ole32',
    'ext-ms-win-ntuser-message-l1-1-0': 'user32',
    'ext-ms-win-ntuser-window-l1-1-4': 'user32',
    'ext-ms-win-ntuser-window-l1-1-0': 'user32',
    'ext-ms-win-ntuser-windowclass-l1-1-0': 'user32',
    'ext-ms-win-ntuser-menu-l1-1-0': 'user32',
    'ext-ms-win-ntuser-misc-l1-1-0': 'user32',
    'ext-ms-win-ntuser-synch-l1-1-0': 'user32',
};

/** d3dx9_24 … d3dx9_43, d3dx924-style link names */
const D3DX9_VERSIONED = /^d3dx9_?\d+$/i;
/** Debug D3DX9 builds */
const D3DX9_DEBUG = /^d3dx9d_\d+$/i;

function stripDllExtension(value: string): string {
    return value.replace(/\.dll$/i, "");
}

/**
 * Normalize a DLL path or base name to lowercase without extension.
 */
export function normalizeDllBaseName(value: string): string {
    const trimmed = value.trim().replace(/^"+|"+$/g, "").replace(/\//g, "\\");
    const base = stripDllExtension(trimmed.split("\\").pop() ?? trimmed);
    return base.toLowerCase();
}

/**
 * Resolve a requested DLL name to the canonical HLE module name.
 * Returns the normalized base name when no alias applies.
 */
export function resolveThunkedDllAlias(name: string): string {
    const base = normalizeDllBaseName(name);
    if (!base) return base;

    const apiSetHost = API_SET_HOSTS[base];
    if (apiSetHost) return apiSetHost;

    const staticTarget = STATIC_ALIASES[base];
    if (staticTarget) return staticTarget;

    if (D3DX9_VERSIONED.test(base) || D3DX9_DEBUG.test(base)) {
        return "d3dx9";
    }

    return base;
}

/**
 * True when the requested name aliases to a different canonical module.
 */
export function isThunkedDllAlias(name: string): boolean {
    const base = normalizeDllBaseName(name);
    return base !== resolveThunkedDllAlias(name);
}
