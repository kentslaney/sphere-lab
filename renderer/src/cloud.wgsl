struct Uniforms { mvp: mat4x4f, model: mat4x4f }
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
struct Out { @builtin(position) position: vec4f, @location(0) color: vec3f }
@vertex fn point(@location(0) position: vec3f, @location(1) color: vec3f,
                @builtin(vertex_index) index: u32) -> Out {
    let corners = array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(1,1),vec2f(-1,-1),vec2f(1,1),vec2f(-1,1));
    var p = uniforms.mvp * vec4f(position,1);
    p = vec4f(p.xy + corners[index] * 0.0028 * p.w, p.zw);
    return Out(p,color);
}
@vertex fn line(@location(0) position: vec3f, @location(1) color: vec3f) -> Out {
    return Out(uniforms.mvp * vec4f(position,1), color);
}
@fragment fn color(in: Out) -> @location(0) vec4f { return vec4f(in.color,1); }
