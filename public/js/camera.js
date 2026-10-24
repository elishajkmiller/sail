// How the mouse and keys turn the camera: pure functions on a { yaw, pitch, lastDrag } record, so that they can be tested without a browser.

import { clamp } from './util.js';

export const PITCH_MIN = 0.08;
export const PITCH_MAX = 1.3;
/** How far a dragged mouse turns the camera, and how much less moving the mouse in free look does (it is not slowed by a finger on the button). */
export const DRAG = 0.006;
export const FREE = 0.0035;

/** Turns the camera by a mouse movement of (dx, dy) pixels: right turns right, down tilts the camera over the ship. */
export function look(cam, dx, dy, k = DRAG, now = 0) {
  cam.yaw += dx * k;
  cam.pitch = clamp(cam.pitch + dy * k * 0.7, PITCH_MIN, PITCH_MAX);
  cam.lastDrag = now;
}

/** Z and X: turns the camera round at a steady rate (`dir` is -1, 0 or 1). */
export function turn(cam, dir, dt, now = 0) {
  if (!dir) return;
  cam.yaw += dir * 1.8 * dt;
  cam.lastDrag = now;
}

/** Swings the camera round to look the way the boat points, by the shorter way round. */
export function follow(cam, heading, dt, rate = 1.0) {
  const d = Math.atan2(Math.sin(heading - cam.yaw), Math.cos(heading - cam.yaw));
  cam.yaw += d * (1 - Math.exp(-rate * dt));
}

/** How long the camera stays where it was put before it drifts back behind the boat. Long: you can sail forward and look about, and it is not taken from you. */
export const STAY = 8;

/** Whether the camera should drift back behind the boat: only at the helm of the boat, long after the mouse was last used, and never in free look. */
export function shouldFollow(cam, now, { onFoot, freeLook }) {
  return !onFoot && !freeLook && now - cam.lastDrag > STAY;
}

/** R: puts the camera straight behind whatever he is steering or walking (`heading`: the way the boat points, or the way he faces). */
export function recenter(cam, heading, now = 0) {
  cam.yaw = heading;
  cam.pitch = 0.42;
  cam.lastDrag = now - STAY - 1; // and it follows the boat again from here
}
