"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
let preferences;
const context = vm.createContext({ OTT2: { define(name, factory) { preferences = factory(); } } });
require("./load-core.cjs")(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/playback-preferences.js"), "utf8"), context);
function capture() {
    const result=[];
    const tracks=[{id:"0",language:"ru",label:"Russian commentary"},{id:"1",language:"eng",label:"English"},{id:"2",language:"rus",label:"Russian original"},{id:3,language:"",label:""}];
    for (const language of [undefined,"","RU"," rus ","en","eng","de","en_US","__proto__"])
        for (const label of [undefined,"","Russian original","russian COMMENTARY ","English","not-present"])
            for (const backend of ["native","hls.js"])
                for (const id of ["1",3,"3"]){
                    const choice={language,label,id,backend:"native"};
                    const found=preferences.matchTrack(tracks,choice,backend);
                    result.push({choice,backend,index:found===null?-1:tracks.indexOf(found)});
                }
    return JSON.parse(JSON.stringify(result));
}
const target=path.join(__dirname,"fixtures/playback-policy/tracks-before-core.json");
if(process.argv.includes("--capture")){
    assert(!fs.existsSync(target));
    fs.writeFileSync(target,JSON.stringify({baseline:"f429f537497ec95c2bf92781e1ecee86c18bbfe8",observed:capture()},null,2)+"\n");
}else test("track choices retain language aliases, ambiguity and strict backend IDs",()=>{
    assert.deepEqual(capture(),JSON.parse(fs.readFileSync(target,"utf8")).observed);
});
