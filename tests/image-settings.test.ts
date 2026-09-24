/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { resolutionBase, aspectToSize } from '../app/lib/providers/image-unpack';
import { normalizeResolution, RESOLUTIONS } from '../app/lib/image-presets';
import { APP_VERSION } from '../app/lib/version';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('image resolution presets', () => {
  it('maps 512 / 1k / 2k to pixel bases', () => {
    expect(resolutionBase('512')).toBe(512);
    expect(resolutionBase('1k')).toBe(1024);
    expect(resolutionBase('2k')).toBe(2048);
    expect(normalizeResolution('2048')).toBe('2k');
    expect(normalizeResolution('0.5k')).toBe('512');
    expect(RESOLUTIONS.map((r) => r.id)).toEqual(['512', '1k', '2k']);
  });

  it('keeps 16:9 1k on a 16-pixel grid', () => {
    const size = aspectToSize('16:9', '1k');
    expect(size.width).toBe(1024);
    expect(size.height % 16).toBe(0);
  });
});

describe('app version', () => {
  it('matches package.json', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
    expect(APP_VERSION).toBe(pkg.version);
  });
});
