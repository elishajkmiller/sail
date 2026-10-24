import test from 'node:test';
import assert from 'node:assert/strict';
import { look, turn, follow, shouldFollow, PITCH_MIN, PITCH_MAX, DRAG, FREE } from '../public/js/camera.js';

const cam = () => ({ yaw: 0, pitch: 0.42, lastDrag: -10 });

test('the mouse turns the camera right when it moves right, and tilts it, within limits', () => {
  const c = cam();
  look(c, 100, 0, DRAG, 5);
  assert.ok(c.yaw > 0.5 && c.pitch === 0.42 && c.lastDrag === 5);
  look(c, 0, 10000);
  assert.equal(c.pitch, PITCH_MAX, 'it cannot be tipped over the top');
  look(c, 0, -10000);
  assert.equal(c.pitch, PITCH_MIN, 'nor below the water');
  assert.ok(FREE < DRAG);
});

test('Z and X turn the camera at a steady rate, and nothing pressed changes nothing', () => {
  const c = cam();
  turn(c, 0, 1, 3);
  assert.deepEqual(c, cam());
  turn(c, 1, 0.5, 3);
  assert.ok(Math.abs(c.yaw - 0.9) < 1e-9 && c.lastDrag === 3);
  turn(c, -1, 1, 4);
  assert.ok(c.yaw < 0);
});

test('the camera swings behind the boat by the short way round', () => {
  const c = cam();
  c.yaw = 3.0;
  for (let i = 0; i < 100; i++) follow(c, -3.0, 0.02);
  assert.ok(Math.abs(Math.atan2(Math.sin(c.yaw + 3.0), Math.cos(c.yaw + 3.0))) < 0.05, 'it ends up behind her');
  assert.ok(c.yaw > 3.0, 'going on past pi, not back the long way round');
  const d = cam();
  follow(d, 1, 0.02);
  assert.ok(d.yaw > 0 && d.yaw < 1);
});

test('the camera only drifts back when he is sailing, has not touched the mouse and is not in free look', () => {
  const c = cam();
  assert.ok(shouldFollow(c, 5, { onFoot: false, freeLook: false }));
  assert.ok(!shouldFollow(c, 5, { onFoot: true, freeLook: false }), 'on foot it stays where it is');
  assert.ok(!shouldFollow(c, 5, { onFoot: false, freeLook: true }), 'free look keeps it where it is looked');
  c.lastDrag = 4.5;
  assert.ok(!shouldFollow(c, 5, { onFoot: false, freeLook: false }), 'not at once after the mouse was moved');
});
