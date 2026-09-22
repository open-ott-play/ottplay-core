"use strict";
const assert=require('node:assert/strict'), {run}=require('./stalker-fixture.cjs');
const fixture=require('./fixtures/stalker-before-core.json');
for(const [index,row] of fixture.cases.entries())assert.deepEqual(run(row.input),row.expected,'Captured Stalker contract '+index);
console.log('PASS '+fixture.cases.length+' captured browser Stalker contracts');
