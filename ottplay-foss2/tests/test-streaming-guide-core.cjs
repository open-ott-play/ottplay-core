"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, invoke } = require('./epg-fixture.cjs');
const contracts = require('./fixtures/streaming-guide-before-core.json');

test('streaming guide preserves captured HTTP responses, ordering and byte budgets', async () => {
    for (const row of contracts.cases) {
        const f = fixture({ ...row.input.options, now: () => contracts.provenance.clock }, { body: Buffer.from(row.input.xml) });
        const result = await invoke(f.epg, { channels: row.input.channels }).result;
        assert.deepEqual({ status: result.status, body: result.body }, row.expected, row.name);
    }
});
