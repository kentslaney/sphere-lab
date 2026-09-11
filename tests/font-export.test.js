import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

test('exported font atlas texture and binary exist and have expected dimensions', () => {
  const pngPath = path.join(ROOT, 'models', 'font_atlas.png');
  const binPath = path.join(ROOT, 'models', 'font_atlas.bin');
  assert.ok(fs.existsSync(pngPath), 'font_atlas.png should exist');
  assert.ok(fs.existsSync(binPath), 'font_atlas.bin should exist');

  const binStats = fs.statSync(binPath);
  // 512 x 512 x 4 bytes (RGBA) = 1,048,576 bytes
  assert.equal(binStats.size, 512 * 512 * 4, 'Raw font texture binary should be 1MB');

  const pngStats = fs.statSync(pngPath);
  assert.ok(pngStats.size > 1000, 'PNG font atlas should be non-empty');
});

test('exported font metrics JSON covers ASCII glyphs 32 through 126', () => {
  const jsonPath = path.join(ROOT, 'models', 'font_metrics.json');
  assert.ok(fs.existsSync(jsonPath), 'font_metrics.json should exist');

  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  assert.equal(data.atlasWidth, 512);
  assert.equal(data.atlasHeight, 512);
  assert.equal(data.cellWidth, 32);
  assert.equal(data.cellHeight, 64);

  // Verify critical characters: digits, letters, dot, minus, space
  const critical = [' ', '0', '1', '9', 'A', 'C', 'M', '.', '-'];
  for (const ch of critical) {
    const code = ch.charCodeAt(0).toString();
    assert.ok(data.glyphs[code], `Glyph for '${ch}' should exist in metrics`);
    const g = data.glyphs[code];
    assert.equal(g.uv.length, 4);
    assert.ok(g.uv[2] > g.uv[0], 'u1 should be greater than u0');
    assert.ok(g.uv[3] > g.uv[1], 'v1 should be greater than v0');
  }
});

test('exported WGSL font module contains valid shader declarations', () => {
  const wgslPath = path.join(ROOT, 'renderer', 'src', 'font.wgsl');
  assert.ok(fs.existsSync(wgslPath), 'font.wgsl should exist');

  const content = fs.readFileSync(wgslPath, 'utf8');
  assert.ok(content.includes('fn get_glyph_uv(ascii_code: u32) -> GlyphUV'), 'Should export get_glyph_uv');
  assert.ok(content.includes('struct GlyphUV'), 'Should define GlyphUV struct');
  assert.ok(content.includes('fs_font_text'), 'Should define fragment shader');
});
