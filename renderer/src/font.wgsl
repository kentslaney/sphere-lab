// Auto-generated WGSL font texture helpers.
// Atlas size: 512x512, cell size: 32x64, grid: 16x8 (ASCII 32-126)

struct GlyphUV {
    uv_min: vec2f,
    uv_max: vec2f,
};

// Computes texture UV bounding box [u0, v0, u1, v1] for an ASCII character code.
fn get_glyph_uv(ascii_code: u32) -> GlyphUV {
    let clamped_code = clamp(ascii_code, 32u, 126u);
    let idx = clamped_code - 32u;
    let col = f32(idx % 16u);
    let row = f32(idx / 16u);
    let cell_w_norm = 32f / 512f;
    let cell_h_norm = 64f / 512f;
    let u0 = col * cell_w_norm;
    let v0 = row * cell_h_norm;
    let u1 = u0 + cell_w_norm;
    let v1 = v0 + cell_h_norm;
    return GlyphUV(vec2f(u0, v0), vec2f(u1, v1));
}

struct FontVertexOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
    @location(1) color: vec4f,
};

// Fragment shader for sampling font atlas texture
@fragment
fn fs_font_text(
    in: FontVertexOutput,
    @group(0) @binding(1) font_texture: texture_2d<f32>,
    @group(0) @binding(2) font_sampler: sampler
) -> @location(0) vec4f {
    let sampled = textureSample(font_texture, font_sampler, in.uv);
    return vec4f(in.color.rgb, in.color.a * sampled.a);
}
