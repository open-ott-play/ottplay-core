"use strict";
// Reproduce the PNG app icons from the same simple geometry as icon.svg.
// Run with Node.js; this development tool is never served to browsers.
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const background = [17, 21, 25, 255];
const accent = [244, 197, 121, 255];
function rounded(x, y, left, top, width, height, radius) {
    if (x < left || x >= left + width || y < top || y >= top + height) return false;
    const dx = Math.max(left + radius - x, 0, x - (left + width - radius));
    const dy = Math.max(top + radius - y, 0, y - (top + height - radius));
    return dx * dx + dy * dy <= radius * radius;
}
function pixel(x, y) {
    if (!rounded(x, y, 0, 0, 512, 512, 96)) return [0, 0, 0, 0];
    if (rounded(x, y, 96, 112, 320, 224, 28) && !rounded(x, y, 112, 128, 288, 192, 14)) return accent;
    if (x >= 216 && x <= 296 && Math.abs(y - 224) <= (296 - x) * 0.6) return accent;
    if (x >= 232 && x < 280 && y >= 336 && y < 384) return accent;
    if (x >= 192 && x < 320 && y >= 384 && y < 400) return accent;
    return background;
}
function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
    const contents = Buffer.concat([Buffer.from(type), bytes]);
    const length = Buffer.alloc(4), crc = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    crc.writeUInt32BE(crc32(contents));
    return Buffer.concat([length, contents, crc]);
}
for (const size of [192, 512]) {
    const raw = Buffer.alloc(size * (size * 4 + 1));
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const sums = [0, 0, 0, 0];
            for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
                const color = pixel((x + (sx + 0.5) / 4) * 512 / size, (y + (sy + 0.5) / 4) * 512 / size);
                for (let channel = 0; channel < 4; channel++) sums[channel] += color[channel];
            }
            const offset = y * (size * 4 + 1) + 1 + x * 4;
            for (let channel = 0; channel < 4; channel++) raw[offset + channel] = Math.round(sums[channel] / 16);
        }
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(size); header.writeUInt32BE(size, 4);
    header[8] = 8; header[9] = 6;
    const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
    fs.writeFileSync(path.join(__dirname, "icon-" + size + ".png"), png);
}
