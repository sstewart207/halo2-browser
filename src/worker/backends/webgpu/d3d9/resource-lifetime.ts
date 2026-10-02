/** COM ownership for D3D9 resources. Texture subresources share their container's lifetime. */
export class ResourceLifetime {
    private objects = new Map<number, { refs: number; destroy: () => void }>();
    private aliases = new Map<number, number>();

    register(ptr: number, destroy: () => void): void {
        this.objects.set(ptr, { refs: 1, destroy });
    }

    alias(ptr: number, container: number): void {
        // A cached surface is part of its texture, not an extra external reference.
        this.objects.delete(ptr);
        this.aliases.set(ptr, container);
    }

    count(ptr: number): number {
        return this.objects.get(this.aliases.get(ptr) ?? ptr)?.refs ?? 0;
    }

    addRef(ptr: number): number {
        const object = this.objects.get(this.aliases.get(ptr) ?? ptr);
        return object ? ++object.refs : 0;
    }

    release(ptr: number): number {
        const root = this.aliases.get(ptr) ?? ptr;
        const object = this.objects.get(root);
        if (!object) return 0;
        if (--object.refs !== 0) return object.refs;
        this.objects.delete(root);
        for (const [alias, parent] of this.aliases) {
            if (parent === root) this.aliases.delete(alias);
        }
        object.destroy();
        return 0;
    }

    clear(): void {
        // Whole-emulator reset discards guest memory separately.
        this.objects.clear();
        this.aliases.clear();
    }
}

export const d3d9ResourceLifetime = new ResourceLifetime();

/** Device and state-block bindings own references independently of the caller. */
export class ResourceBindings {
    private slots = new Map<string, number>();
    constructor(private lifetime: ResourceLifetime = d3d9ResourceLifetime) {}

    set(slot: string, ptr: number): void {
        const previous = this.slots.get(slot) ?? 0;
        if (previous === ptr) return;
        if (ptr) this.lifetime.addRef(ptr);
        if (ptr) this.slots.set(slot, ptr);
        else this.slots.delete(slot);
        if (previous) this.lifetime.release(previous);
    }

    clear(): void {
        const pointers = [...this.slots.values()];
        this.slots.clear();
        for (const ptr of pointers) this.lifetime.release(ptr);
    }
}
