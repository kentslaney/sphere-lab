struct Uniforms { mvp: mat4x4<f32>, model: mat4x4<f32> };
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(1) @binding(0) var menu_texture: texture_2d<f32>;
@group(1) @binding(1) var menu_sampler: sampler;
struct Vertex { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vs(@location(0) position: vec3<f32>, @location(1) uv: vec2<f32>) -> Vertex {
    var out: Vertex;
    out.position = uniforms.mvp * vec4<f32>(position, 1.0);
    out.uv = uv;
    return out;
}
@fragment fn fs(in: Vertex) -> @location(0) vec4<f32> {
    return textureSample(menu_texture, menu_sampler, in.uv);
}
