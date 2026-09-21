/*
 * pack-apk.js —— 正确打包 APK 的工具（修复 resources.arsc 压缩问题）
 *
 * 用法:
 *   node pack-apk.js <基础APK> <输出APK> [附加目录]
 *
 * 作用:
 *   1. 读取 aapt 生成的基础 APK（含 AndroidManifest.xml / resources.arsc / res/）
 *   2. 把「附加目录」下的所有文件（如 classes.dex、assets/）一并打进包里
 *   3. 强制让 resources.arsc 以「存储(不压缩)」方式写入
 *      —— Android 11(API 30) 以上要求它不压缩且 4 字节对齐，否则拒绝安装
 *   4. 丢弃旧的 META-INF（签名由 apksigner 重新生成）
 *
 * 打包完还需两步:
 *   zipalign -f -v 4 输出APK 对齐后APK
 *   apksigner sign --ks ... --v1-signing-enabled true --v2-signing-enabled true \
 *                  --v3-signing-enabled true --min-sdk-version 21 对齐后APK
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const [, , BASE, OUT, ADD] = process.argv;
if (!BASE || !OUT) {
  console.error('用法: node pack-apk.js <基础APK> <输出APK> [附加目录]');
  process.exit(1);
}

/* ---------- CRC32 ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (~c) >>> 0;
};

/* ---------- 读取基础 APK 的所有条目（解压成原始数据） ---------- */
function readEntries(file) {
  const b = fs.readFileSync(file);
  let e = -1;
  for (let i = b.length - 22; i >= 0 && i > b.length - 70000; i--) {
    if (b.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  }
  if (e < 0) throw new Error('找不到 EOCD，不是有效的 ZIP/APK: ' + file);

  const total = b.readUInt16LE(e + 10);
  const cdOff = b.readUInt32LE(e + 16);
  const out = [];
  let o = cdOff;

  for (let i = 0; i < total; i++) {
    if (b.readUInt32LE(o) !== 0x02014b50) throw new Error('中央目录签名异常 @' + o);
    const method = b.readUInt16LE(o + 10);
    const csize = b.readUInt32LE(o + 20);
    const nlen = b.readUInt16LE(o + 28);
    const elen = b.readUInt16LE(o + 30);
    const clen = b.readUInt16LE(o + 32);
    const lho = b.readUInt32LE(o + 42);
    const name = b.toString('utf8', o + 46, o + 46 + nlen);

    const lnlen = b.readUInt16LE(lho + 26);
    const lelen = b.readUInt16LE(lho + 28);
    const dOff = lho + 30 + lnlen + lelen;
    const raw = b.subarray(dOff, dOff + csize);

    if (!name.startsWith('META-INF/')) {
      out.push({ name, data: method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw) });
    }
    o += 46 + nlen + elen + clen;
  }
  return out;
}

/* ---------- 收集附加目录的文件 ---------- */
function collectDir(dir, prefix = '') {
  const res = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    const name = prefix ? prefix + '/' + item.name : item.name;
    if (item.isDirectory()) res.push(...collectDir(full, name));
    else res.push({ name, data: fs.readFileSync(full) });
  }
  return res;
}

/* ---------- 写入 ZIP ---------- */
function writeZip(items, dst) {
  const DOS_TIME = 0;
  const DOS_DATE = 0x5a21; // 2026-01-01
  const chunks = [];
  const cd = [];
  let off = 0;

  for (const it of items) {
    // 关键：resources.arsc 必须不压缩
    const store = it.name === 'resources.arsc';
    const payload = store ? it.data : zlib.deflateRawSync(it.data, { level: 9 });
    const method = store ? 0 : 8;
    const nb = Buffer.from(it.name, 'utf8');
    const crc = crc32(it.data);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(DOS_TIME, 10);
    lh.writeUInt16LE(DOS_DATE, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(payload.length, 18);
    lh.writeUInt32LE(it.data.length, 22);
    lh.writeUInt16LE(nb.length, 26);
    lh.writeUInt16LE(0, 28);
    chunks.push(lh, nb, payload);

    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0, 8);
    c.writeUInt16LE(method, 10);
    c.writeUInt16LE(DOS_TIME, 12);
    c.writeUInt16LE(DOS_DATE, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(payload.length, 20);
    c.writeUInt32LE(it.data.length, 24);
    c.writeUInt16LE(nb.length, 28);
    c.writeUInt16LE(0, 30);
    c.writeUInt16LE(0, 32);
    c.writeUInt16LE(0, 34);
    c.writeUInt16LE(0, 36);
    c.writeUInt32LE(0o644 << 16, 38);
    c.writeUInt32LE(off, 42);
    cd.push(c, nb);

    console.log('  ' + (store ? '存储' : '压缩') + '  ' + it.name);
    off += 30 + nb.length + payload.length;
  }

  const cdBuf = Buffer.concat(cd);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(items.length, 8);
  eocd.writeUInt16LE(items.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(off, 16);
  eocd.writeUInt16LE(0, 20);

  fs.writeFileSync(dst, Buffer.concat([...chunks, cdBuf, eocd]));
}

/* ---------- 主流程 ---------- */
const base = readEntries(BASE);
const extra = ADD && fs.existsSync(ADD) ? collectDir(ADD) : [];

// 同名时附加目录优先（覆盖基础包里的旧文件）
const map = new Map();
for (const it of base) map.set(it.name, it);
for (const it of extra) map.set(it.name, it);

// 顺序：清单 → 资源表 → 其余（前面的条目加载更快）
const names = [...map.keys()];
const order = [];
for (const first of ['AndroidManifest.xml', 'resources.arsc']) {
  if (names.includes(first)) order.push(first);
}
order.push(...names.filter((n) => !order.includes(n)));

const items = order.map((n) => map.get(n));
console.log('打包 ' + items.length + ' 个条目:');
writeZip(items, OUT);

const arsc = items.find((i) => i.name === 'resources.arsc');
console.log('\n写出: ' + OUT + '  (' + (fs.statSync(OUT).size / 1024).toFixed(1) + ' KB)');
console.log(arsc ? 'resources.arsc 已设为存储(不压缩) ✅' : '⚠️ 未找到 resources.arsc');
