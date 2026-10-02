import type { IModule } from '../core/module';
import type { Process } from '../core/process';
import type { ThunkImplementation } from '../core/thunking/thunk-dispatcher';
import { Mem } from '../core/memory/mem-accessor';

export const E_NOTIMPL = 0x80004001;
export const E_POINTER = 0x80004003;

/** The session/topology backend is not implemented yet. Report that honestly:
 * a positive Win32 error is a successful HRESULT, and native Windows proxy DLLs
 * cannot supply the missing system implementation inside the guest.
 * https://learn.microsoft.com/en-us/windows/win32/api/mfapi/nf-mfapi-mfstartup
 */
export class MediaFoundation implements IModule {
    exports: Record<string, ThunkImplementation> = {};
    constructor(public readonly name: 'mf' | 'mfplat') {}

    initialize(_process: Process): void {
        if (this.name === 'mfplat') {
            this.exports.MFStartup = () => ({ value: E_NOTIMPL, stackCleanup: 8 });
            this.exports.MFShutdown = () => ({ value: E_NOTIMPL, stackCleanup: 0 });
            return;
        }
        const creators: Array<[string, number, number]> = [
            ['MFCreateTopology', 1, 0],
            ['MFCreateMediaSession', 2, 1],
            ['MFCreateAudioRendererActivate', 1, 0],
            ['MFCreateVideoRendererActivate', 2, 1],
            ['MFCreateTopologyNode', 2, 1],
            ['MFCreateSourceResolver', 1, 0],
            ['MFGetService', 4, 3],
        ];
        for (const [name, count, outputIndex] of creators) {
            this.exports[name] = (_ctx, _memory, args) => {
                const output = args[outputIndex] >>> 0;
                const cleared = output !== 0 && Mem.writeUint32(output, 0);
                return { value: cleared ? E_NOTIMPL : E_POINTER, stackCleanup: count * 4 };
            };
        }
    }
}
