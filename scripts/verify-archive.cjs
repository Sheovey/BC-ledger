/**
 * 本机自动存档验收。
 *
 * 前提：cli.bat auto --project . --auto-port 9420 已运行，且已执行过 taro build。
 * 执行顺序：放在 verify-settings / verify-backup 之后跑（会清空存档目录）。
 *
 * 为什么单独一套：
 * 手写 ZIP + OOXML 有三个「界面完全正常但文件打不开」的坑——ZIP 头偏移、
 * XML 子元素顺序、文体转义。这些光点界面看不出来，必须把沙箱里的字节取出来，
 * 用独立实现逐条目重算 CRC、逐部件解析 XML 才能验穿。
 *
 * 验收分组：
 * A 落盘    B ZIP 结构    C OOXML 内容    D 调度行为    E 界面
 */
const automator = require('miniprogram-automator');
const path = require('path');
const fs = require('fs');

const PORT = process.env.AUTO_PORT || '9420';
const outDir = path.join(__dirname, '..', 'preview');
fs.mkdirSync(outDir, { recursive: true });

const results = [];
const check = (label, pass, detail = '') => {
  results.push({ label, pass, detail });
  console.log(`${pass ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------------- 工具 */

async function waitForPage(mp, keyword, timeout = 12000) {
  const deadline = Date.now() + timeout;
  let last = '';
  while (Date.now() < deadline) {
    const pages = await mp.pageStack();
    last = pages.length ? pages[pages.length - 1].path : '';
    if (last.includes(keyword)) {
      await sleep(400);
      return await mp.currentPage();
    }
    await sleep(200);
  }
  console.log(`   [warn] 等待 ${keyword} 超时，当前 ${last}`);
  return await mp.currentPage();
}

async function tapText(page, selector, text) {
  const els = await page.$$(selector);
  for (const el of els) {
    const t = (await el.text()).trim();
    if (t === text || t.startsWith(text)) {
      await el.tap();
      return true;
    }
  }
  return false;
}

async function rowText(page, keyword) {
  const rows = await page.$$('.settings-row');
  for (const row of rows) {
    const t = (await row.text()).replace(/\s+/g, '');
    if (t.includes(keyword)) return t;
  }
  return '';
}

const listArchives = (mp, force = true) =>
  mp.evaluate((f) => globalThis.__ledgerArchive.listArchives(f), force);

const currentCount = (mp) =>
  mp.evaluate(() => globalThis.__ledgerStore.getState().data.txs.length);

/** 在逻辑层补一条流水，返回补种后的条数 */
const addProbeTx = (mp, tag) =>
  mp.evaluate((t) => {
    const s = globalThis.__ledgerStore.getState();
    const book = s.data.books.find((b) => !b.archived) || s.data.books[0];
    if (!book) return -1;
    const acc = s.data.accounts.find((a) => a.bookId === book.id && !a.archived);
    const cat = s.data.categories.find((c) => c.type === 'expense' && c.parentId && !c.archived);
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const day = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    s.addTx({
      bookId: book.id,
      accountId: acc ? acc.id : null,
      toAccountId: null,
      projectId: null,
      categoryId: cat ? cat.id : null,
      merchant: t,
      type: 'expense',
      amount: 1990,
      note: '存档验收探针',
      occurredAt: `${day}T12:34`,
    });
    return globalThis.__ledgerStore.getState().data.txs.length;
  }, tag);

/** 把沙箱里的文件按 base64 取出，落到 preview/verify/ */
async function pullFile(mp, filePath, name) {
  const b64 = await mp.evaluate(
    (p) => wx.getFileSystemManager().readFileSync(p, 'base64'),
    filePath,
  );
  const dir = path.join(outDir, 'verify');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, name);
  fs.writeFileSync(out, Buffer.from(b64, 'base64'));
  return out;
}

/* --------------------------------------------------- ZIP / CRC 独立实现 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 解析 STORE 版 zip。不压缩所以不需要任何解压库，可直接切片。 */
function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65558); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('找不到 EOCD');

  const total = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);

  const entries = [];
  let off = cdOffset;
  for (let i = 0; i < total; i += 1) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error(`第 ${i + 1} 条中央目录签名错误`);
    const method = buf.readUInt16LE(off + 10);
    const crc = buf.readUInt32LE(off + 16);
    const csize = buf.readUInt32LE(off + 20);
    const usize = buf.readUInt32LE(off + 24);
    const fnLen = buf.readUInt16LE(off + 28);
    const exLen = buf.readUInt16LE(off + 30);
    const cmLen = buf.readUInt16LE(off + 32);
    const localOffset = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + fnLen);

    const lfnLen = buf.readUInt16LE(localOffset + 26);
    const lexLen = buf.readUInt16LE(localOffset + 28);
    const versionNeeded = buf.readUInt16LE(localOffset + 4);
    const localSig = buf.readUInt32LE(localOffset);
    const start = localOffset + 30 + lfnLen + lexLen;
    const data = buf.subarray(start, start + csize);

    entries.push({ name, method, crc, csize, usize, data, versionNeeded, localSig });
    off += 46 + fnLen + exLen + cmLen;
  }
  return { entries, eocd, cdSize, cdOffset, buf };
}

/* ------------------------------------------------------------------ 主流程 */

async function main() {
  const mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${PORT}` });

  await mp.reLaunch('/pages/home/index');
  await sleep(1500);

  // ---------- 0. 干净起点 ----------
  await mp.evaluate(() => {
    globalThis.__ledgerArchive.clearArchives();
    globalThis.__ledgerArchive.setArchiveBudget(8 * 1024 * 1024);
  });
  let base = await currentCount(mp);
  if (base < 3) {
    await addProbeTx(mp, '存档基线');
    await sleep(700);
    base = await currentCount(mp);
  }
  console.log(`\n起始流水 ${base} 条`);

  // ---------- A. 落盘 ----------
  const nowResult = await mp.evaluate(() => globalThis.__ledgerArchive.archiveNow());
  const xlsxResult = nowResult.find((r) => r.kind === 'xlsx');
  check('archiveNow 写出了表格文件', Boolean(xlsxResult && xlsxResult.ok), JSON.stringify(nowResult));

  const after1 = await listArchives(mp);
  const xlsxEntry = after1.find((e) => e.kind === 'xlsx');
  check('存档目录里有 xlsx', Boolean(xlsxEntry), xlsxEntry ? xlsxEntry.name : '无');
  check('xlsx 大小大于 0', Boolean(xlsxEntry && xlsxEntry.size > 0), xlsxEntry ? `${xlsxEntry.size} B` : '');
  check('快照 json 也写出了', after1.some((e) => e.kind === 'json' && e.name.startsWith('snap-')));

  const tmpLeak = after1.filter((e) => e.name.endsWith('.tmp') || e.name.endsWith('.bak'));
  check('没有 .tmp / .bak 残留', tmpLeak.length === 0, tmpLeak.map((e) => e.name).join(','));

  // 同名覆盖，不产生 (1)
  await mp.evaluate(() => globalThis.__ledgerArchive.writeBookXlsx());
  const after2 = await listArchives(mp);
  const xlsxNames = after2.filter((e) => e.kind === 'xlsx').map((e) => e.name);
  check('同名覆盖，不产生 (1) 副本', xlsxNames.length === 1, xlsxNames.join(','));

  // ---------- B/C. 取字节独立校验 ----------
  const localXlsx = await pullFile(mp, xlsxEntry.path, 'archive.xlsx');
  console.log(`   已导出 ${localXlsx}（${fs.statSync(localXlsx).size} B）`);
  const buf = fs.readFileSync(localXlsx);

  let zip = null;
  try {
    zip = readZip(buf);
  } catch (e) {
    check('ZIP 可被独立解析', false, e.message);
  }

  if (zip) {
    const names = zip.entries.map((e) => e.name);
    check('ZIP 可被独立解析', true, `${names.length} 个条目`);
    check('[Content_Types].xml 是第一条目', names[0] === '[Content_Types].xml', names[0]);
    check('文件名无前导斜杠或反斜杠', names.every((n) => !n.startsWith('/') && !n.includes('\\')));
    check(
      '全部条目为 STORE 且 csize === usize',
      zip.entries.every((e) => e.method === 0 && e.csize === e.usize),
      zip.entries.filter((e) => e.method !== 0 || e.csize !== e.usize).map((e) => e.name).join(','),
    );
    check(
      '本地头签名与 versionNeeded 正确',
      zip.entries.every((e) => e.localSig === 0x04034b50 && e.versionNeeded === 20),
    );

    const crcMismatch = zip.entries.filter((e) => crc32(e.data) !== e.crc).map((e) => e.name);
    check('逐条目重算 CRC32 与记录一致', crcMismatch.length === 0, crcMismatch.join(','));

    const cdEnd = zip.cdOffset + zip.cdSize;
    check('EOCD 的目录偏移与大小自洽', cdEnd === zip.eocd, `目录结束 ${cdEnd} / EOCD ${zip.eocd}`);

    const sheetParts = names.filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
    // 固定部件 5 个：[Content_Types].xml / _rels/.rels / workbook.xml / workbook.xml.rels / styles.xml
    check('部件数量 = 5 固定部件 + N 工作表', names.length === 5 + sheetParts.length, `${names.length} / ${sheetParts.length} 张表`);

    const text = (name) => {
      const entry = zip.entries.find((e) => e.name === name);
      return entry ? entry.data.toString('utf8') : '';
    };

    const workbook = text('xl/workbook.xml');
    const sheetNames = [...workbook.matchAll(/<sheet name="([^"]*)"/g)].map((m) => m[1]);
    check('五张工作表名称正确', sheetNames.join('/') === '概览/流水/分类汇总/账户/预算', sheetNames.join('/'));

    const contentTypes = text('[Content_Types].xml');
    const overrideCount = (contentTypes.match(/<Override /g) || []).length;
    check('Content Types 声明了 workbook + 各表 + styles', overrideCount === 2 + sheetParts.length, `${overrideCount} 条`);

    const styles = text('xl/styles.xml');
    const fillsTag = styles.match(/<fills count="(\d+)">([\s\S]*?)<\/fills>/);
    const fillCount = fillsTag ? (fillsTag[2].match(/<fill>/g) || []).length : -1;
    check('styles 的 fills 为 2 项且计数一致', Boolean(fillsTag) && Number(fillsTag[1]) === fillCount && fillCount === 2, `count=${fillsTag ? fillsTag[1] : '?'} 实际=${fillCount}`);
    const xfsTag = styles.match(/<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/);
    const xfCount = xfsTag ? (xfsTag[2].match(/<xf /g) || []).length : -1;
    check('cellXfs 的 count 与实际 xf 数一致', Boolean(xfsTag) && Number(xfsTag[1]) === xfCount, `${xfsTag ? xfsTag[1] : '?'} / ${xfCount}`);

    const flow = text('xl/worksheets/sheet2.xml');
    const rows = (flow.match(/<row /g) || []).length;
    const bookTxCount = await mp.evaluate((b) => {
      const s = globalThis.__ledgerStore.getState();
      const book = s.data.books.find((x) => !x.archived) || s.data.books[0];
      return s.data.txs.filter((t) => t.bookId === book.id).length;
    });
    check('流水表行数 = 账本流水数 + 表头', rows === bookTxCount + 1, `表 ${rows} 行 / 流水 ${bookTxCount} 条`);

    // 金额列必须是数值单元格：无 t 属性且有 <v>
    const firstRow = flow.match(/<row r="2">([\s\S]*?)<\/row>/);
    const e2 = firstRow ? firstRow[1].match(/<c r="E2"([^>]*)>([\s\S]*?)<\/c>/) : null;
    check('金额单元格 E2 无 t 属性（Excel 可求和）', Boolean(e2) && !/\bt="/.test(e2[1]), e2 ? e2[1].trim() : '缺失');
    check('金额单元格 E2 是 <v> 数值', Boolean(e2) && /<v>[-\d.]+<\/v>/.test(e2[2]), e2 ? e2[2] : '');

    const headerRow = flow.match(/<row r="1">([\s\S]*?)<\/row>/);
    check('表头套用了加粗样式 s="2"', Boolean(headerRow) && /<c r="A1" s="2"/.test(headerRow[1]));

    // 文本单元格使用 inlineStr，且 XML 里没有未转义的裸 &
    check('文本单元格使用 inlineStr', /t="inlineStr"/.test(flow));
    const bareAmp = /&(?!amp;|lt;|gt;|quot;|apos;|#)/.test(flow);
    check('XML 里没有未转义的裸 &', bareAmp === false);
  }

  // ---------- D. 调度行为 ----------
  // D1 快照去重：数据没变时再调 onHide 不写第二份
  const hide1 = await mp.evaluate(() => globalThis.__ledgerArchive.archiveOnHide());
  check('数据未变时 onHide 按签名短路', hide1 && hide1.ok === true && hide1.reason === 'skipped', JSON.stringify(hide1));

  // D2 快照轮转只留 3 份
  for (let i = 0; i < 3; i += 1) {
    await addProbeTx(mp, `轮转探针${i}`);
    await sleep(1300);
    await mp.evaluate(() => globalThis.__ledgerArchive.writeSnapshotJson(true));
  }
  const snaps = (await listArchives(mp)).filter((e) => e.kind === 'json');
  check('快照滚动只保留 3 份', snaps.length === 3, `实际 ${snaps.length} 份`);

  // D3 空账本不覆盖已有存档
  const emptyBook = await mp.evaluate(() => {
    const s = globalThis.__ledgerStore.getState();
    const id = s.addBook('空账本验收');
    const res = globalThis.__ledgerArchive.writeBookXlsx(id);
    return { id, res };
  });
  check('空账本请求存档返回 no-data', emptyBook.res && emptyBook.res.ok === false && emptyBook.res.reason === 'no-data', JSON.stringify(emptyBook.res));
  const stillThere = (await listArchives(mp)).some((e) => e.kind === 'xlsx' && e.name === xlsxEntry.name);
  check('空数据不会覆盖已有表格存档', stillThere === true);
  await mp.evaluate((id) => {
    if (id) globalThis.__ledgerStore.getState().deleteBook(id);
  }, emptyBook.id);

  // D4 60 秒门限：连续写入不会立刻重写表格
  const beforeGate = (await listArchives(mp)).find((e) => e.kind === 'xlsx');
  await addProbeTx(mp, '门限探针');
  await sleep(5000);
  const afterGate = (await listArchives(mp)).find((e) => e.kind === 'xlsx');
  check(
    '60 秒门限内不重写表格',
    afterGate && afterGate.mtime === beforeGate.mtime,
    `${beforeGate.mtime} → ${afterGate.mtime}`,
  );

  console.log('   等待 60 秒门限到期，验证延后补写…');
  await sleep(62000);
  const afterWait = (await listArchives(mp)).find((e) => e.kind === 'xlsx');
  check(
    '门限到期后自动补写表格',
    afterWait && afterWait.mtime > afterGate.mtime,
    `${afterGate.mtime} → ${afterWait.mtime}`,
  );

  // D5 预算守卫：压缩预算后清旧档，但绝不删当前账本的表格
  const pruned = await mp.evaluate(() => {
    const before = globalThis.__ledgerArchive.listArchives(true);
    globalThis.__ledgerArchive.setArchiveBudget(1);
    globalThis.__ledgerArchive.scheduleArchive('manual');
    return before.filter((e) => e.kind === 'xlsx').map((e) => e.name);
  });
  await sleep(1500);
  const afterPrune = await listArchives(mp);
  check(
    '超预算时保留当前账本的表格',
    pruned.every((name) => afterPrune.some((e) => e.name === name)),
    `保留 ${afterPrune.map((e) => e.name).join(',')}`,
  );
  await mp.evaluate(() => globalThis.__ledgerArchive.setArchiveBudget(8 * 1024 * 1024));

  // D6 存档失败必须静默降级：不影响记账，也不报 storageError
  const degraded = await mp.evaluate(() => {
    const s = globalThis.__ledgerStore.getState();
    const book = s.data.books.find((b) => !b.archived) || s.data.books[0];
    const acc = s.data.accounts.find((a) => a.bookId === book.id && !a.archived);
    const before = s.data.txs.length;
    const original = wx.getFileSystemManager;
    wx.getFileSystemManager = () => {
      throw new Error('boom');
    };
    const archiveResult = globalThis.__ledgerArchive.writeBookXlsx();
    wx.getFileSystemManager = original;

    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const day = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    s.addTx({
      bookId: book.id,
      accountId: acc ? acc.id : null,
      toAccountId: null,
      projectId: null,
      categoryId: null,
      merchant: '降级探针',
      type: 'expense',
      amount: 100,
      note: '验证存档失败不影响记账',
      occurredAt: `${day}T09:00`,
    });
    const after = globalThis.__ledgerStore.getState();
    return { archiveResult, before, after: after.data.txs.length, storageError: after.storageError };
  });
  await sleep(900);
  check('文件系统异常时存档返回 fs-error 而不抛错', degraded.archiveResult && degraded.archiveResult.reason === 'fs-error', JSON.stringify(degraded.archiveResult));
  check('存档失败不影响记账写入', degraded.after === degraded.before + 1, `${degraded.before} → ${degraded.after}`);
  check('存档失败不产生 storageError', degraded.storageError === null, String(degraded.storageError));

  // ---------- E. 界面 ----------
  await mp.reLaunch('/pages/settings/index');
  await sleep(1200);
  const page = await waitForPage(mp, 'settings');

  const shareRow = await rowText(page, '发送最新存档到聊天');
  const viewRow = await rowText(page, '查看本机存档');
  const nowRow = await rowText(page, '立即存档');
  check('有「发送最新存档到聊天」入口', Boolean(shareRow), shareRow);
  check('有「查看本机存档」入口并显示数量', /个/.test(viewRow), viewRow);
  check('有「立即存档」入口', Boolean(nowRow), nowRow);
  check('说明行点明「和微信缓存一起消失」', (await rowText(page, '同生共死')).length > 0 || (await rowText(page, '微信存储空间')).length > 0);

  const tappedNow = await tapText(page, '.settings-row', '立即存档');
  await sleep(1600);
  check('点「立即存档」可点击', tappedNow === true);
  const nowRowAfter = await rowText(page, '立即存档');
  check('存档后右侧显示今天', /今天/.test(nowRowAfter), nowRowAfter);

  // 先截「本机存档」分组本身，再开弹层——否则弹层会把分组整个盖住
  try {
    await mp.evaluate(() => {
      try {
        wx.pageScrollTo({ scrollTop: 980, duration: 0 });
      } catch (e) {
        /* 滚动失败不影响结论 */
      }
    });
    await sleep(800);
    const shotGroup = path.join(outDir, 'settings-archive.png');
    await mp.screenshot({ path: shotGroup });
    console.log(`\n截图: ${shotGroup}`);
  } catch (e) {
    console.log('截图失败（不影响结论）:', e.message);
  }

  const opened = await tapText(page, '.settings-row', '查看本机存档');
  await sleep(900);
  check('点「查看本机存档」可点击', opened === true);
  const sheetTitle = await page.$('.sheet__title');
  check('点「查看本机存档」弹出弹层', Boolean(sheetTitle), sheetTitle ? await sheetTitle.text() : '未找到');
  const archiveRows = await page.$$('.sheet .settings-row');
  check('弹层里列出了存档文件', archiveRows.length >= 1, `${archiveRows.length} 行`);

  try {
    const shotSheet = path.join(outDir, 'settings-archive-sheet.png');
    await mp.screenshot({ path: shotSheet });
    console.log(`截图: ${shotSheet}`);
  } catch (e) {
    console.log('截图失败（不影响结论）:', e.message);
  }

  await mp.disconnect();

  const failed = results.filter((r) => !r.pass);
  console.log(`\n合计 ${results.length} 项，通过 ${results.length - failed.length} 项，失败 ${failed.length} 项`);
  if (failed.length) {
    failed.forEach((f) => console.log(`  ❌ ${f.label} ${f.detail}`));
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('脚本异常:', e);
  process.exitCode = 1;
});
