import assert from 'node:assert/strict';
import core from '../shared-core/dist/ottplay-core.js';

function number(data, offset) {
  if (offset + 8 > data.length) return 0;
  return data.readDoubleLE(offset);
}
export function fuzz(data) {
  if (data.length > 4096) return;
  const now = number(data, 0);
  const limit = number(data, 8);
  const rows = [];
  for (let offset = 16; offset + 16 <= data.length; offset += 16) {
    rows.push(Object.freeze({start: number(data, offset), end: number(data, offset + 8)}));
  }
  Object.freeze(rows);
  const actual = core.guideScheduleSelection(rows, now, limit);
  if (!Number.isFinite(now)) {
    assert.equal(actual.current, null);
    assert.deepEqual(actual.following, []);
    assert.equal(actual.retryAt, 0);
    return;
  }
  const valid = rows.filter(row => Number.isFinite(row.start) && Number.isFinite(row.end) && row.start < row.end);
  const active = valid.filter(row => row.start <= now && now < row.end).sort((a, b) => b.start - a.start);
  const future = valid.filter(row => row.start > now).sort((a, b) => a.start - b.start);
  const count = Number.isNaN(limit) || limit <= 0 ? 0 : Math.min(1000, Math.floor(limit));
  assert.equal(actual.current, active[0] ?? null, 'latest-starting active row, stable tie order');
  assert.deepEqual(actual.following, future.slice(0, count), 'ordered future rows respect bounded requested count');
  const retry = Math.min(now + 3600, active[0]?.end ?? Infinity, future[0]?.start ?? Infinity);
  assert.equal(actual.retryAt, retry);
}
