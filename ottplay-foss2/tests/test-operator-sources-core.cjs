const test = require('node:test');
const assert = require('node:assert/strict');
const runner = require('./operator-source-fixture.cjs');
const fixture = require('./fixtures/operator/sources-before-core.json');
for (const row of fixture.cases) test('shared operator source '+JSON.stringify(row.input), ()=>{
 assert.deepEqual(runner.run(row.input), row.expected);
});
