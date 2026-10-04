# CHECKPOINT — NEWEST-94 (October 3, 2026)

**The runtime page is real, resident in guest memory at the stop, and its first instructions are confirmed by measurement rather than by inference.** CHECKPOINT-93's untested hypothesis is now closed. Still no AOT menu/video/campaign/60-fps acceptance, and the stop is unchanged at `0x1970421` — but the decoder now has verified input and a verified hook target.

## What was measured

Captured the full 4096 bytes at `0x1970000` from live guest memory **after** the boot had stopped:

```
non-zero bytes: 3630 / 4096
bytes at page offset 0x421: 56 8b 74 24 08 85 f6 e8 9e f8 e1
```

Decoded from those bytes, at page offset `0x421` (VA `0x1970421`, exactly the stop address):

| Bytes | Instruction |
|---|---|
| `56` | `PUSH ESI` |
| `8b 74 24 08` | `MOV ESI, [ESP+8]` |
| `85 f6` | `TEST ESI, ESI` |
| `e8 9e f8 e1 fe` | `CALL rel32` |

and the call resolves:

```
CALL at VA 0x197042d -> rel32 -18745186 -> target 0x78fccb
```

**`0x78fccb` is exactly the profiling hook CHECKPOINT-92 named.** The prefix and the hook target are both confirmed from live bytes, not reconstructed from a disassembly listing.

This also settles what `ESP+8` means here: the hook is called through the rewritten return slot, and `MOV ESI,[ESP+8]` is the hook reading its first argument off the guest stack.

## A real tooling bug found along the way

`harness.call("readBytes", [addr, len])` **silently drops the second argument.** The RPC handler defaults `len` to 64:

```ts
// src/worker/harness/cmds/state.ts
const len = Math.min(Math.max(((args[1] as number) ?? 64) >>> 0, 1), 0x10000);
```

So a request for 4096 bytes returned `len: 64` and **no error** — which reads exactly like "the page is empty." My first three dump attempts chased that phantom; the 3-non-zero-byte result was a 64-byte read, not a 4096-byte one.

The CLI path coerces arguments correctly, so this works and returns the full range:

```bash
bun tools/harness.ts readBytes 0x1970000 0x400
```

**Anyone scripting against the harness should verify `len` in the response before trusting the contents.** A silent default is worse than a thrown error, because it produces a confident wrong answer. Worth fixing at the transport layer rather than working around, but it is not fixed here — recorded so the next agent does not lose time to it.

## Provenance claim not reproduced

CHECKPOINT-92 reported **4063/4096** bytes matching EXE page `0x661e28`. **I did not reproduce that.** Comparing the live page against the EXE at that address gives 466/4096, with differences scattered across the whole page rather than in three small regions. Searching the EXE for the page's own fingerprint lands at file offset `0x262428`, which matches only 88/4096.

So the specific claim "4063/4096 match, three patched regions" does **not** hold against the bytes I captured. Possibilities, none yet tested:

- The earlier figure was measured against a different page instance, a different session, or a pre-relocation snapshot. The page is built at runtime, so it may not be byte-identical between runs.
- The page may be relocated: if pointers inside it were adjusted during the copy, most bytes would legitimately differ from any static EXE region, which fits the scattered diff pattern far better than "three small patches."
- The earlier comparison may have used a different address convention.

**Do not treat the 4063/4096 figure as established.** What *is* established is the prefix at `0x421` and the `0x78fccb` target, both read from live memory.

An additional observation worth recording: the page begins `0f 58 fe f3` (`ADDPS` with a broadcast-style mask), `0f 10 74 24 18` (`MOVUPS XMM6, [ESP+0x18]`) — dense SSE, consistent with vector data being copied and transformed rather than ordinary scalar code.

## Next step

Decode the reachable patched bytes from live guest memory and execute them, then transfer to `0x78fccb`. This is now a concrete task rather than a hypothesis:

- **Input is verified**: `tmp/dynamic93-page.bin`, 4096 bytes, 3630 non-zero, captured at the stop.
- **Entry point is verified**: page offset `0x421` / VA `0x1970421`.
- **Exit target is verified**: `0x78fccb`.
- **Cross-boundary state exists**: the CF/PF/ZF/SF/OF globals committed in `5c3dd1e` carry the flags that `TEST ESI,ESI` at `0x1970426` sets, which is precisely what the hook reads to choose its branch. That prerequisite is done.

Still required, and **not yet started**:

1. Prove a decoded prefix and a faithful hook transition in a **synthetic test** before running Chrome.
2. Decide how execution interacts with the recompiler for genuinely runtime code — this is an interpreter path, not a lift path, since no static image contains these bytes.
3. No decoder dependency is in the repo. iced-x86 proved capable in a private spike; adding it is a real decision with a dependency cost.

## Reproducing the capture

```bash
# harness Chrome is ours to launch; the dev tab may need creating
bun tools/harness.ts readBytes 0x1970000 0x400     # repeat at +0x400, +0x800, +0xc00
```

The boot must have reached the stop first — the page is allocated by the guest, so an early read returns zeroes. That is why polling produced nothing on the first pass: the boot had not yet arrived.

`tmp/dump-runtime-page.ts` is the scripted version; it polls but was written against the buggy `.call()` path and its 64-byte results are not trustworthy.

## State of the tree

- Branch `codex/halo2-browser-checkpoint`, clean, in sync with origin.
- No source change this checkpoint: nothing needed fixing, only measuring.
- Tests and typecheck unchanged from the last green run (1094 pass / 0 fail, tsc exit 0); no compiled code was touched.
- Private artifacts stay out of Git: `tmp/dynamic93-page.bin` and the EXE.