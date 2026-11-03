import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';

const rootDir = path.resolve(__dirname, '..');
const read = (relativePath: string) => fs.readFileSync(path.join(rootDir, relativePath));
const packageJson = JSON.parse(read('package.json').toString('utf8'));

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface DecodedPng {
  width: number;
  height: number;
  channels: number;
  pixels: Buffer;
}

// Minimal decoder for 8-bit, non-interlaced RGB/RGBA PNGs (the format logo.png is rendered in).
function decodePng(buffer: Buffer): DecodedPng {
  expect(buffer.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Buffer[] = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data[8];
      const colorType = data[9];
      expect(bitDepth).toBe(8);
      expect(data[12]).toBe(0);
      expect([2, 6]).toContain(colorType);
      channels = colorType === 6 ? 4 : 3;
    } else if (type === 'IDAT') {
      idat.push(data);
    }
    offset += length + 12;
  }

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upLeft = y > 0 && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      pixels[y * stride + x] = (line[x] + predictor) & 0xff;
    }
  }
  return { width, height, channels, pixels };
}

function glyphShape(svg: string) {
  return {
    paths: [...svg.matchAll(/\sd="([^"]+)"/g)].map((match) => match[1]),
    transforms: [...svg.matchAll(/<g transform="([^"]+)"/g)]
      .map((match) => match[1])
      .filter((transform) => !transform.includes('scale(16)')),
  };
}

describe('branding assets', () => {
  it('uses the rendered listing PNG as the extension icon', () => {
    expect(packageJson.icon).toBe('media/logo.png');
  });

  it('ships a fully opaque 512x512 listing icon', () => {
    const png = decodePng(read('media/logo.png'));

    expect([png.width, png.height]).toEqual([512, 512]);
    if (png.channels === 4) {
      for (let index = 3; index < png.pixels.length; index += 4) {
        if (png.pixels[index] !== 255) {
          throw new Error(`Pixel ${(index - 3) / 4} is not opaque (alpha ${png.pixels[index]})`);
        }
      }
    }
  });

  it('draws the listing tile from the same glyph as the Activity Bar icon', () => {
    const sidebar = read('media/sidebar-icon.svg').toString('utf8');
    const tile = read('media/marketplace-icon.svg').toString('utf8');

    expect(sidebar).not.toContain('<text');
    expect(sidebar).not.toMatch(/#[0-9a-f]{3,6}/i);
    expect(glyphShape(sidebar).paths).toHaveLength(5);
    expect(glyphShape(tile)).toEqual(glyphShape(sidebar));
  });

  it('keeps the Activity Bar icon theme-aware and backgroundless', () => {
    const sidebar = read('media/sidebar-icon.svg').toString('utf8');

    expect(sidebar).not.toContain('<rect');
    expect(sidebar.match(/fill="([^"]+)"/g)?.every((fill) => fill === 'fill="currentColor"')).toBe(true);
  });
});
