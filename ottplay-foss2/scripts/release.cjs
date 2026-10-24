#!/usr/bin/env node
/* Build a reproducible, allowlisted candidate archive without runtime dependencies. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const root=path.resolve(__dirname,'..');
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const roots=['src','ui','vendor','fonts','icons','licenses','assets','docs','scripts','tests'];
const top=['index.html','manifest.webmanifest','package.json','package-lock.json','LICENSE','README.md','TECHNICAL-SPEC.md','MEDIA-API.md','THIRD-PARTY-NOTICES.md'];
const requiredChecks=Object.freeze(['unit-es5-resources-vendors','browser','browser-providers','browser-engines','browser-media','browser-epg','browser-browse','browser-compat','browser-scroll','browser-controls','browser-startup','browser-window-controls']);
function files(base=root) {
    const result=[];
    function add(name) {
        const stat=fs.lstatSync(path.join(base,name));
        if(stat.isSymbolicLink()) throw new Error('Release inputs cannot be symbolic links: '+name);
        if(stat.isDirectory()) for(const child of fs.readdirSync(path.join(base,name)).sort()) add(name+'/'+child);
        else if(stat.isFile()) result.push({name,data:fs.readFileSync(path.join(base,name))});
    }
    top.concat(roots).forEach(add); return result.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
}
function crc32(bytes) {
    let crc=0xffffffff;
    for(const byte of bytes) {crc^=byte;for(let i=0;i<8;i++) crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
    return (crc^0xffffffff)>>>0;
}
function zip(entries,prefix) {
    const local=[],central=[]; let offset=0,centralLength=0;
    for(const entry of entries) {
        const name=Buffer.from(prefix+'/'+entry.name), data=zlib.deflateRawSync(entry.data,{level:9}),crc=crc32(entry.data);
        const header=Buffer.alloc(30); header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(8,8);header.writeUInt16LE(33,12);
        header.writeUInt32LE(crc,14);header.writeUInt32LE(data.length,18);header.writeUInt32LE(entry.data.length,22);header.writeUInt16LE(name.length,26);
        const directory=Buffer.alloc(46);directory.writeUInt32LE(0x02014b50);directory.writeUInt16LE(20,4);directory.writeUInt16LE(20,6);directory.writeUInt16LE(0x800,8);directory.writeUInt16LE(8,10);directory.writeUInt16LE(33,14);
        directory.writeUInt32LE(crc,16);directory.writeUInt32LE(data.length,20);directory.writeUInt32LE(entry.data.length,24);directory.writeUInt16LE(name.length,28);directory.writeUInt32LE(offset,42);
        local.push(header,name,data);central.push(directory,name);offset+=header.length+name.length+data.length;centralLength+=directory.length+name.length;
    }
    const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(centralLength,12);end.writeUInt32LE(offset,16);
    return Buffer.concat(local.concat(central,[end]));
}
function versionChannel(version) {
    const match=/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)-(beta|rc)\.[1-9]\d*$/.exec(version);
    if(!match) throw new Error('A numbered beta or RC version is required; stable releases promote verified RC bytes');
    return match[1];
}
function validateReport(report,entries,version) {
    const invalid=()=>{throw new Error('Release validation is missing, incomplete or stale; run npm run verify:release');};
    if(!report || report.version!==version || report.passed!==true || report.inputsUnchanged!==true) invalid();
    if(!Array.isArray(report.checks) || report.checks.length!==requiredChecks.length) invalid();
    if(report.checks.some((check,index)=>!check || check.name!==requiredChecks[index] || check.exitCode!==0 || check.signal!==null)) invalid();
    if(!report.sourceHashes || typeof report.sourceHashes!=='object' || Array.isArray(report.sourceHashes)) invalid();
    if(Object.keys(report.sourceHashes).length!==entries.length || new Set(entries.map(entry=>entry.name)).size!==entries.length) invalid();
    for(const entry of entries) if(report.sourceHashes[entry.name]!==digest(entry.data)) invalid();
}
function build(output=path.join(root,'releases'),expectedChannel='beta') {
    const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json')));
    const channel=versionChannel(pkg.version);
    if(channel!==expectedChannel) throw new Error('Requested channel does not match package version');
    const name='ottplay-foss2-'+pkg.version,entries=files(),manifest={name:pkg.name,version:pkg.version,channel,files:{}};
    const validation=path.join(root,'test-results','release-'+pkg.version,'validation.json');
    if(!fs.existsSync(validation)) throw new Error('Release validation is missing; run npm run verify:release');
    validateReport(JSON.parse(fs.readFileSync(validation,'utf8')),entries,pkg.version);
    for(const entry of entries) manifest.files[entry.name]={bytes:entry.data.length,sha256:digest(entry.data)};
    const metadata=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
    entries.push({name:'release-manifest.json',data:metadata});
    const bytes=zip(entries,name),directory=path.join(output,pkg.version);
    fs.mkdirSync(directory,{recursive:true});
    fs.writeFileSync(path.join(directory,name+'.zip'),bytes);
    fs.writeFileSync(path.join(directory,'release-manifest.json'),metadata);
    fs.writeFileSync(path.join(directory,'SHA256SUMS'),digest(bytes)+'  '+name+'.zip\n'+digest(metadata)+'  release-manifest.json\n');
    return {version:pkg.version,archive:path.join(directory,name+'.zip'),files:entries.length,bytes:bytes.length,sha256:digest(bytes)};
}
if(require.main===module) {
    const args=process.argv.slice(2);
    if(args.length>1 || (args.length===1 && !/^--channel=(beta|rc)$/.test(args[0]))) throw new Error('Usage: release.cjs [--channel=beta|--channel=rc]');
    const channel=args.length ? args[0].slice('--channel='.length) : 'beta';
    console.log(JSON.stringify(build(undefined,channel),null,2));
}
module.exports={files,zip,build,versionChannel,requiredChecks,validateReport};
