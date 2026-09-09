struct Uniforms { mvp: mat4x4f, model: mat4x4f }
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
struct VertexOut { @builtin(position) position: vec4f, @location(0) normal: vec3f }
@vertex fn vs(@location(0) position: vec3f, @location(1) normal: vec3f) -> VertexOut {
    var out: VertexOut;
    out.position = uniforms.mvp * vec4f(position, 1.0);
    out.normal = (uniforms.model * vec4f(normal, 0.0)).xyz;
    return out;
}
@fragment fn fs(in: VertexOut) -> @location(0) vec4f {
    let brightness = 0.25 + 0.75 * max(dot(normalize(in.normal), normalize(vec3f(1, 2, 3))), 0.0);
    return vec4f(vec3f(0.12, 0.65, 1.0) * brightness, 1.0);
}
