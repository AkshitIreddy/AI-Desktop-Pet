import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/overlay/engine/displayGeometry.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const { displayGeometry } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

function layout({ w = 2560, h = 1440, scale = 2, workH = h, x = 0, y = 0 } = {}) {
  return { x, y, w, h: h - 2, scale, monitors: [
    { x, y, w, h, workX: x, workY: y, workW: w, workH, scale, primary: true },
  ] };
}

test('1440p uses the live WebView DPI when native DPI is still from the old layout', () => {
  const vs = layout();
  const env = displayGeometry(vs, 1.5);
  assert.equal(env.scale, 1.5);
  assert.equal(env.height, 1438 / 1.5);
  assert.equal(env.monitors[0].floorY * env.scale, 1438);
  // The same scale places the hit region exactly over the drawn pet.
  const spriteY = env.monitors[0].floorY - 100;
  assert.equal(spriteY * env.scale + 100 * env.scale, 1438);
  assert.notEqual(spriteY, 1438 / vs.scale - 100);
});

test('a visible taskbar sets the walking floor above the reserved area', () => {
  const env = displayGeometry(layout({ workH: 1392 }), 1.25);
  assert.equal(env.monitors[0].floorY, 1392 / 1.25);
  assert.ok(env.monitors[0].floorY < env.height);
});

test('a live change from 4K to 1440p replaces the previous floor', () => {
  const before = displayGeometry(layout({ w: 3840, h: 2160 }), 2);
  const after = displayGeometry(layout(), 1);
  assert.equal(after.width, 2560);
  assert.equal(after.monitors[0].floorY, 1438);
  assert.notEqual(after.monitors[0].floorY, before.monitors[0].floorY);
});

test('mixed-DPI monitors share the overlay scale and retain their own floors', () => {
  const vs = layout({ x: -1920, w: 4480, h: 1600, scale: 2 });
  vs.monitors = [
    { x: -1920, y: 0, w: 1920, h: 1080, workX: -1920, workY: 0, workW: 1920, workH: 1040, scale: 1 },
    { x: 0, y: 0, w: 2560, h: 1600, workX: 0, workY: 0, workW: 2560, workH: 1600, scale: 1.5, primary: true },
  ];
  const env = displayGeometry(vs, 1.5);
  assert.equal(env.monitors[0].floorY, 1040 / 1.5);
  assert.equal(env.monitors[1].floorY, 1598 / 1.5);
  assert.equal(env.originX + env.monitors[1].left * env.scale, 0);
  assert.equal(env.monitors[0].right, env.monitors[1].left);
});
