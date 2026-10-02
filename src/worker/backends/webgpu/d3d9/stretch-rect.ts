/// <reference types="@webgpu/types" />
export type CopyRect = [number, number, number, number];

export function validCopyRect(rect: CopyRect, width: number, height: number): boolean {
    const [left, top, right, bottom] = rect;
    return rect.every(Number.isInteger) && left >= 0 && top >= 0 && right > left && bottom > top && right <= width && bottom <= height;
}

/** GPU-side surface copy, including scale/filter and channel-format conversion. */
export class SurfaceCopier {
    private pipelines = new Map<GPUTextureFormat, GPURenderPipeline>();
    private samplers = new Map<boolean, GPUSampler>();
    constructor(private device: GPUDevice) {}

    copy(source: GPUTexture, sourceLevel: number, sourceLayer: number, src: CopyRect,
        target: GPUTexture, targetLevel: number, targetLayer: number, dst: CopyRect, linear: boolean): boolean {
        if (source === target) return false;
        const sourceWidth = Math.max(1, source.width >>> sourceLevel), sourceHeight = Math.max(1, source.height >>> sourceLevel);
        const targetWidth = Math.max(1, target.width >>> targetLevel), targetHeight = Math.max(1, target.height >>> targetLevel);
        if (!validCopyRect(src, sourceWidth, sourceHeight) || !validCopyRect(dst, targetWidth, targetHeight)) return false;
        let pipeline = this.pipelines.get(target.format);
        if (!pipeline) {
            const module = this.device.createShaderModule({ code: `
struct Params { uv: vec4<f32> };
@group(0) @binding(0) var image: texture_2d<f32>;
@group(0) @binding(1) var filtering: sampler;
@group(0) @binding(2) var<uniform> params: Params;
struct Vertex { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vs(@builtin(vertex_index) index: u32) -> Vertex {
    let p = array<vec2<f32>, 3>(vec2(0.0,0.0),vec2(2.0,0.0),vec2(0.0,2.0))[index];
    var out: Vertex; out.position=vec4(p.x*2.0-1.0,1.0-p.y*2.0,0.0,1.0);
    out.uv=params.uv.xy+p*params.uv.zw; return out;
}
@fragment fn fs(input: Vertex) -> @location(0) vec4<f32> {
    return textureSampleLevel(image,filtering,input.uv,0.0);
}` });
            pipeline = this.device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vs' },
                fragment: { module, entryPoint: 'fs', targets: [{ format: target.format }] }, primitive: { topology: 'triangle-list' } });
            this.pipelines.set(target.format, pipeline);
        }
        let sampler = this.samplers.get(linear);
        if (!sampler) {
            sampler = this.device.createSampler({ minFilter: linear ? 'linear' : 'nearest', magFilter: linear ? 'linear' : 'nearest' });
            this.samplers.set(linear, sampler);
        }
        const params = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.device.queue.writeBuffer(params, 0, new Float32Array([src[0]/sourceWidth, src[1]/sourceHeight,
            (src[2]-src[0])/sourceWidth, (src[3]-src[1])/sourceHeight]));
        const view = (texture: GPUTexture, level: number, layer: number) => texture.createView({ dimension: '2d',
            baseMipLevel: level, mipLevelCount: 1, baseArrayLayer: layer, arrayLayerCount: 1 });
        const group = this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
            { binding: 0, resource: view(source, sourceLevel, sourceLayer) }, { binding: 1, resource: sampler },
            { binding: 2, resource: { buffer: params } },
        ] });
        const encoder = this.device.createCommandEncoder();
        const pass = encoder.beginRenderPass({ colorAttachments: [{ view: view(target, targetLevel, targetLayer), loadOp: 'load', storeOp: 'store' }] });
        pass.setPipeline(pipeline); pass.setBindGroup(0, group);
        pass.setViewport(dst[0], dst[1], dst[2]-dst[0], dst[3]-dst[1], 0, 1);
        pass.setScissorRect(dst[0], dst[1], dst[2]-dst[0], dst[3]-dst[1]);
        pass.draw(3); pass.end(); this.device.queue.submit([encoder.finish()]);
        params.destroy();
        return true;
    }
}
