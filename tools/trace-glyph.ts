import { harness } from "./harness";

// Two one-shot questions answered by function-entry traces (no pausing, so the
// run keeps its normal speed):
//   0x4991aa  FUN_004991aa — per-character glyph draw loop
//   0x48dc9a  FUN_0048dc9a — glyph record lookup for (font, char)
// Both are in halo2.exe, image base 0x400000. Then force the menu to redraw by
// moving the selection, and report the breakpoint state.
const r = await harness()
    .breakOn(0x4991aa, { continuous: true, pause: false, fast: true })
    .breakOn(0x48dc9a, { continuous: true, pause: false, fast: true })
    .key(40)
    .tickFrames(90)
    .key(40)
    .tickFrames(90)
    .expect("debugState", [])
    .run();

console.log(JSON.stringify(r, null, 2));