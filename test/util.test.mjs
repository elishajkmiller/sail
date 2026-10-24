import test from 'node:test';
import assert from 'node:assert/strict';
import { valid, clean, cleanText, parseIso, ago, parseTarget, rng, hash32, humanBytes } from '../public/js/util.js';

test('names are checked', () => {
  assert.ok(valid('deck') && valid('a.b-c_d'));
  for (const bad of ['', '.', '..', 'a b', 'a/b', '../x', 'x'.repeat(101), null, 5]) assert.ok(!valid(bad), String(bad));
});

test('text from GitHub is cleaned', () => {
  assert.equal(clean('a‮b​c\x07d', 50), 'abcd');
  assert.equal(clean('  two   words\n\tand more ', 50), 'two words and more');
  assert.equal(clean('abcdefghij', 8), 'abcde...');
  assert.equal(clean('<script>x</script>', 50), '<script>x</script>', 'markup is only text; the page shows it with textContent');
  assert.equal(cleanText('one\r\ntwo\n\n\n\nthree‮\x07\tfour', 100), 'one\ntwo\n\nthree four');
  assert.equal(cleanText('  \n hello \n ', 100), 'hello');
});

test('dates are read', () => {
  assert.equal(parseIso('1970-01-01T00:00:00Z'), 0);
  assert.equal(parseIso('2000-03-01T00:00:00Z'), 951868800);
  assert.equal(parseIso('2024-02-29T12:00:01Z'), 1709208001);
  assert.equal(parseIso('yesterday'), 0);
  assert.equal(ago(1000, 1000 + 3 * 86400), '3 days ago');
  assert.equal(ago(1000, 1000 + 86400 * 800), '2 years ago');
  assert.equal(ago(0, 5), 'never');
});

test('a typed repo goes straight to it and other text is a search', () => {
  const repo = (o, n) => ({ repo: [o, n] });
  assert.deepEqual(parseTarget('deck/mast'), repo('deck', 'mast'));
  assert.deepEqual(parseTarget('  deck/mast  '), repo('deck', 'mast'));
  assert.deepEqual(parseTarget('https://github.com/deck/mast'), repo('deck', 'mast'));
  assert.deepEqual(parseTarget('https://github.com/deck/mast/issues/12?x=1#top'), repo('deck', 'mast'));
  assert.deepEqual(parseTarget('github.com/deck/mast.git'), repo('deck', 'mast'));
  assert.deepEqual(parseTarget('git@github.com:deck/mast.git'), repo('deck', 'mast'));
  for (const t of ['tetris', 'tetris clone', 'a/b/c', 'deck / mast', '../etc', 'deck/ma st', 'https://example.com/deck/mast', '']) assert.ok(parseTarget(t).text !== undefined, t);
});

test('the random source repeats', () => {
  const a = rng(hash32('deck/mast')), b = rng(hash32('deck/mast')), c = rng(hash32('other'));
  const xs = [a(), a(), a()], ys = [b(), b(), b()];
  assert.deepEqual(xs, ys);
  assert.notDeepEqual(xs, [c(), c(), c()]);
  assert.ok(xs.every((x) => x >= 0 && x < 1));
  assert.equal(humanBytes(1536), '1.5 KB');
});
