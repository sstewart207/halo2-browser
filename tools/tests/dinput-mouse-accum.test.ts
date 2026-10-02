import { describe, expect, test, beforeEach } from "bun:test";
import { WindowManager } from "../../src/worker/runtime/windowing/window-manager";
import { InputManager } from "../../src/worker/runtime/input/input-manager";

describe("DirectInput mouse accumulator and harness movement injection", () => {
    let wm: WindowManager;
    let im: InputManager;
    let sab: SharedArrayBuffer;

    beforeEach(() => {
        wm = new WindowManager();
        im = new InputManager(wm);
        sab = new SharedArrayBuffer(1024);
        im.setInputBuffer(sab);
    });

    test("injectMoveAtScreen updates mouse coordinates and accumulates DInput deltas", () => {
        expect(im.getDInputAccum()).toEqual({ x: 0, y: 0 });

        // First move from (0, 0) to (100, 200)
        im.injectMoveAtScreen(100, 200);
        expect(im.getDInputAccum()).toEqual({ x: 100, y: 200 });

        // Second move to (120, 190) -> dx=+20, dy=-10
        im.injectMoveAtScreen(120, 190);
        expect(im.getDInputAccum()).toEqual({ x: 120, y: 190 });

        // Stationary move to (120, 190) -> no delta change
        im.injectMoveAtScreen(120, 190);
        expect(im.getDInputAccum()).toEqual({ x: 120, y: 190 });
    });

    test("injectRelativeMove accumulates relative deltas directly into DInput", () => {
        im.injectMoveAtScreen(100, 100);
        expect(im.getDInputAccum()).toEqual({ x: 100, y: 100 });

        // Inject relative delta (dx=+35, dy=-40)
        im.injectRelativeMove(35, -40);
        expect(im.getDInputAccum()).toEqual({ x: 135, y: 60 });

        const mouse = im.getMouseState();
        expect(mouse.x).toBe(135);
        expect(mouse.y).toBe(60);
    });

    test("injectButtonAtScreen and injectDragAtScreen update accumulator", () => {
        im.injectMoveAtScreen(50, 50);
        expect(im.getDInputAccum()).toEqual({ x: 50, y: 50 });

        // Button down with move to (60, 70)
        im.injectButtonAtScreen(60, 70, 0, true);
        expect(im.getDInputAccum()).toEqual({ x: 60, y: 70 });

        // Drag from (60, 70) to (100, 110)
        im.injectDragAtScreen(60, 70, 100, 110);
        // End position is (100, 110), so total accum is 100, 110
        expect(im.getDInputAccum()).toEqual({ x: 100, y: 110 });
    });

    test("DirectInput relative delta math (accum - lastSeen) reflects injected movements", () => {
        let lastSeenX = 0;
        let lastSeenY = 0;

        // Move cursor
        im.injectMoveAtScreen(70, -30);
        let accum = im.getDInputAccum();
        let dx = (accum.x - lastSeenX) | 0;
        let dy = (accum.y - lastSeenY) | 0;
        lastSeenX = accum.x;
        lastSeenY = accum.y;

        expect(dx).toBe(70);
        expect(dy).toBe(-30);

        // Next poll without movement: delta is 0
        accum = im.getDInputAccum();
        dx = (accum.x - lastSeenX) | 0;
        dy = (accum.y - lastSeenY) | 0;
        expect(dx).toBe(0);
        expect(dy).toBe(0);

        // Relative look command
        im.injectRelativeMove(15, 25);
        accum = im.getDInputAccum();
        dx = (accum.x - lastSeenX) | 0;
        dy = (accum.y - lastSeenY) | 0;
        lastSeenX = accum.x;
        lastSeenY = accum.y;

        expect(dx).toBe(15);
        expect(dy).toBe(25);
    });
});
