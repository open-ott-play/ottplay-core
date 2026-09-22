const test = require('node:test');
const assert = require('node:assert/strict');
const runner = require('./operator-lifetime-fixture.cjs');
const fixture = require('./fixtures/operator/lifetime-before-core.json');
for (const row of fixture.cases) test('shared operator lifetime '+JSON.stringify(row.input), ()=>{
 assert.deepEqual(runner.run(row.input), row.expected);
});
