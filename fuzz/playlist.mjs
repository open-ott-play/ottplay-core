import assert from 'node:assert/strict';
import core from '../shared-core/dist/ottplay-core.js';

// This adapter never dereferences a URL. Preserve input text to exercise the
// actual Kotlin attribute, line, duplicate-ID and catch-up state machines.
const identity = value => value;
const hash = value => {
  let result = 2166136261;
  for (let index = 0; index < value.length; index++) result = Math.imul(result ^ value.charCodeAt(index), 16777619);
  return (result >>> 0).toString(16);
};
function parse(text) {
  return core.parseBrowserPlaylist(text, 'fuzz', 'offline-source', identity, hash, identity);
}
function check(text) {
  const result = parse(text);
  if (result.failure) {
    assert.ok(['EMPTY', 'FORMAT', 'SIZE', 'LINE_SIZE', 'COUNT'].includes(result.failure));
    return;
  }
  assert.ok(Array.isArray(result.channels));
  assert.ok(result.channels.length <= text.split(/\r\n|\r|\n/).length);
  const ids = result.channels.map(channel => channel.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate persisted channel identifiers');
  assert.equal(new Set(result.epgUrls).size, result.epgUrls.length);
  for (const channel of result.channels) {
    assert.equal(channel.sourceId, 'offline-source');
    assert.ok(['live', 'vod'].includes(channel.kind));
    assert.equal(typeof channel.url, 'string');
    if (channel.catchup) {
      assert.ok(Number.isFinite(channel.catchup.days));
      assert.ok(channel.catchup.days >= 0 && channel.catchup.days <= 30);
    }
  }
  assert.deepEqual(parse(text), result, 'pure parsing must be repeatable');
}
export function fuzz(data) {
  if (data.length > 65536) return;
  const text = data.toString('utf8');
  check(text);
  check('#EXTM3U\n' + text);
}
