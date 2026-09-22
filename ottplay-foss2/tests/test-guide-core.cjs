"use strict";
const assert=require('node:assert/strict'),{run}=require('./guide-fixture.cjs');
const fixture=require('./fixtures/guide-before-core.json');
for(const [index,row] of fixture.cases.entries())assert.deepEqual(run(row.input),row.expected,'Captured guide contract '+index);
console.log('PASS '+fixture.cases.length+' captured browser guide contracts');
