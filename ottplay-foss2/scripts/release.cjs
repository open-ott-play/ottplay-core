#!/usr/bin/env node
/* Build a reproducible, allowlisted beta archive without runtime dependencies. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const root=path.resolve(__dirname,'..');
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const roots=['src','ui','vendor','fonts','icons','licenses','assets','docs','scripts','tests'];
const top=['index.html','manifest.webmanifest','package.json','package-lock.json','LICENSE','README.md','TECHNICAL-SPEC.md','IMPLEMENTATION-STATUS.md','MEDIA-API.md','THIRD-PARTY-NOTICES.md'];
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
function build(output=path.join(root,'releases')) {
    const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json')));
    if(!/^\d+\.\d+\.\d+-beta\.\d+$/.test(pkg.version)) throw new Error('A beta version is required');
    const name='ottplay-foss2-'+pkg.version,entries=files(),manifest={name:pkg.name,version:pkg.version,channel:'beta',files:{}};
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
if(require.main===module) console.log(JSON.stringify(build(),null,2));
module.exports={files,zip,build};
