struct Uniforms { mvp: mat4x4f, model: mat4x4f }
@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct Out { @builtin(position) position: vec4f, @location(0) color: vec3f }
struct PointOut { @builtin(position) position: vec4f, @location(0) color: vec4f }

@vertex fn point(
    @location(0) position: vec3f,
    @location(1) color: vec3f,
    @location(2) rotated: vec4f,
    @builtin(vertex_index) index: u32
) -> PointOut {
    let corners = array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(1,1),vec2f(-1,-1),vec2f(1,1),vec2f(-1,1));
    var p = uniforms.mvp * vec4f(position, 1);
    p = vec4f(p.xy + corners[index] * 0.0028 * p.w, p.zw);

    // Compute determinant of the 2x2 rotated Hessian:
    // rotated is [R00, R01, R10, R11]
    let r00 = rotated.x;
    let r01 = rotated.y;
    let r10 = rotated.z;
    let r11 = rotated.w;

    let det = r00 * r11 - r01 * r10;
    let is_convex = (det > 0.0) && (r00 >= 0.0);
    let is_inward = is_convex && (r00 >= r11);

    // If rotated is populated (non-zero), use half-opacity (0.5) for non-inward/non-concave points.
    // If rotated is all zeros (debug curvature not loaded), full opacity (1.0).
    let has_curvature = (r00 != 0.0) || (r11 != 0.0) || (r01 != 0.0) || (r10 != 0.0);
    let alpha = select(1.0, select(0.5, 1.0, is_inward), has_curvature);

    return PointOut(p, vec4f(color, alpha));
}

@vertex fn line(@location(0) position: vec3f, @location(1) color: vec3f) -> Out {
    return Out(uniforms.mvp * vec4f(position, 1), color);
}
@fragment fn color(in: Out) -> @location(0) vec4f { return vec4f(in.color, 1); }
@fragment fn point_color(in: PointOut) -> @location(0) vec4f { return in.color; }

struct ShellOut { @builtin(position) position: vec4f, @location(0) color: vec4f }
@vertex fn shell(@location(0) position: vec3f, @location(1) color: vec4f) -> ShellOut {
    return ShellOut(uniforms.mvp * vec4f(position, 1), color);
}
@fragment fn shell_color(in: ShellOut) -> @location(0) vec4f { return in.color; }

