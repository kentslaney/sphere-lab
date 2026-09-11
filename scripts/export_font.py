#!/usr/bin/env python3
"""Export font texture atlas, binary texture, metrics JSON, and WGSL shader module for WebGPU."""
import json
import pathlib
import sys
from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
MODELS = ROOT / 'models'
RENDERER_SRC = ROOT / 'renderer' / 'src'

FONT_PATHS = [
    '/System/Library/Fonts/Helvetica.ttc',
    '/System/Library/Fonts/SFNSText.ttf',
    '/System/Library/Fonts/Supplemental/Arial.ttf',
    '/Library/Fonts/Arial.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
]


def load_font(size=36):
    for path in FONT_PATHS:
        p = pathlib.Path(path)
        if p.is_file():
            try:
                return ImageFont.truetype(str(p), size)
            except Exception:
                continue
    return ImageFont.load_default()


def export_font():
    MODELS.mkdir(parents=True, exist_ok=True)
    RENDERER_SRC.mkdir(parents=True, exist_ok=True)

    atlas_size = 512
    cols = 16
    rows = 8
    cell_w = atlas_size // cols  # 32 px
    cell_h = atlas_size // rows  # 64 px

    font = load_font(34)
    image = Image.new('RGBA', (atlas_size, atlas_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    metrics = {
        'atlasWidth': atlas_size,
        'atlasHeight': atlas_size,
        'cellWidth': cell_w,
        'cellHeight': cell_h,
        'glyphs': {}
    }

    # ASCII characters 32 (space) to 126 (~)
    for code in range(32, 127):
        ch = chr(code)
        idx = code - 32
        col = idx % cols
        row = idx // cols
        cx = col * cell_w
        cy = row * cell_h

        # Calculate bounding box and advance width
        bbox = draw.textbbox((0, 0), ch, font=font)
        gw = bbox[2] - bbox[0]
        gh = bbox[3] - bbox[1]
        advance = draw.textlength(ch, font=font) if hasattr(draw, 'textlength') else float(gw)

        # Center glyph within cell
        draw_x = cx + (cell_w - gw) / 2 - bbox[0]
        draw_y = cy + (cell_h - gh) / 2 - bbox[1]

        if ch != ' ':
            draw.text((draw_x, draw_y), ch, fill=(255, 255, 255, 255), font=font)

        u0 = cx / atlas_size
        v0 = cy / atlas_size
        u1 = (cx + cell_w) / atlas_size
        v1 = (cy + cell_h) / atlas_size

        metrics['glyphs'][str(code)] = {
            'char': ch,
            'code': code,
            'uv': [round(u0, 6), round(v0, 6), round(u1, 6), round(v1, 6)],
            'advance': round(advance, 2),
            'width': gw,
            'height': gh,
        }

    # Save PNG atlas
    png_path = MODELS / 'font_atlas.png'
    image.save(png_path, format='PNG')
    print(f'Exported font atlas to {png_path} ({atlas_size}x{atlas_size})')

    # Save raw RGBA binary bytes for direct WebGPU writeTexture
    bin_path = MODELS / 'font_atlas.bin'
    bin_path.write_bytes(image.tobytes())
    print(f'Exported raw font texture binary to {bin_path} ({len(bin_path.read_bytes())} bytes)')

    # Save metrics JSON
    json_path = MODELS / 'font_metrics.json'
    json_path.write_text(json.dumps(metrics, indent=2))
    print(f'Exported font metrics to {json_path}')

    # Generate WGSL helper module
    wgsl_content = generate_wgsl_module(metrics, cols, rows, cell_w, cell_h, atlas_size)
    wgsl_path = RENDERER_SRC / 'font.wgsl'
    wgsl_path.write_text(wgsl_content)
    print(f'Exported WGSL font module to {wgsl_path}')


def generate_wgsl_module(metrics, cols, rows, cell_w, cell_h, atlas_size):
    return f"""// Auto-generated WGSL font texture helpers.
// Atlas size: {atlas_size}x{atlas_size}, cell size: {cell_w}x{cell_h}, grid: {cols}x{rows} (ASCII 32-126)

struct GlyphUV {{
    uv_min: vec2f,
    uv_max: vec2f,
}};

// Computes texture UV bounding box [u0, v0, u1, v1] for an ASCII character code.
fn get_glyph_uv(ascii_code: u32) -> GlyphUV {{
    let clamped_code = clamp(ascii_code, 32u, 126u);
    let idx = clamped_code - 32u;
    let col = f32(idx % {cols}u);
    let row = f32(idx / {cols}u);
    let cell_w_norm = {cell_w}f / {atlas_size}f;
    let cell_h_norm = {cell_h}f / {atlas_size}f;
    let u0 = col * cell_w_norm;
    let v0 = row * cell_h_norm;
    let u1 = u0 + cell_w_norm;
    let v1 = v0 + cell_h_norm;
    return GlyphUV(vec2f(u0, v0), vec2f(u1, v1));
}}

struct FontVertexOutput {{
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
    @location(1) color: vec4f,
}};

// Fragment shader for sampling font atlas texture
@fragment
fn fs_font_text(
    in: FontVertexOutput,
    @group(0) @binding(1) font_texture: texture_2d<f32>,
    @group(0) @binding(2) font_sampler: sampler
) -> @location(0) vec4f {{
    let sampled = textureSample(font_texture, font_sampler, in.uv);
    return vec4f(in.color.rgb, in.color.a * sampled.a);
}}
"""


if __name__ == '__main__':
    export_font()
