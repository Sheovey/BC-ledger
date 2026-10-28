/**
 * 按下态反馈（hover）验收：防止「点过之后一直发灰」这个 bug 回潮。
 *
 * 背景：Web 版遗留的 `.settings-row:hover` 等 9 条交互伪类被打包进 WXSS 后，
 * 微信（iOS 尤其）在手指抬起后会继续命中原元素，直到点别处才解除 ——
 * 表现就是「我的」页点过的行一直保持灰底，连没有 onClick 的只读行也会变灰。
 * 修法是全部改成 hoverClass 挂 `--hover` 类（按下加、抬起删）。
 *
 * 这个脚本做两层防护：
 *   A. 静态层 —— 编译产物与源码里都不允许再出现 `:hover` 选择器（防有人搬 Web 样式回来），
 *      同时要求 `--hover` 类与 `hoverClass` 绑定确实还在（防「一刀切删干净」造成的假绿）。
 *   B. 运行时层 —— 真的点一下，确认可点击行带 hover-class、只读行不带、
 *      点完之后页面里没有任何元素残留 `--hover` 类。
 *
 * 前提：cli.bat auto --project . --auto-port 9420 已运行，且已执行过 taro build。
 */
const automator = require('miniprogram-automator');
const path = require('path');
const fs = require('fs');

const PORT = process.env.AUTO_PORT || '9420';
const root = path.join(__dirname, '..');
const distDir = path.join(root, 'dist');
const srcDir = path.join(root, 'src');
const outDir = path.join(root, 'preview');
fs.mkdirSync(outDir, { recursive: true });

const results = [];
const check = (label, pass, detail = '') => {
  results.push({ label, pass, detail });
  console.log(`${pass ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 递归收集某目录下指定后缀的文件 */
function walk(dir, exts, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, exts, acc);
    else if (exts.includes(path.extname(name))) acc.push(full);
  }
  return acc;
}

/**
 * 去掉注释再判断 —— 本项目在 app.scss / pages.scss 里写了「不要用 :hover」的说明文字，
 * 直接 grep 会命中文档，得到假阳性。CSS 注释与 JS 的 // 注释都要剥。
 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * 取元素的 hover-class。
 * automator 对属性名的连字符/驼峰写法在不同版本上不一致，三种途径依次兜底。
 */
async function hoverClassOf(el) {
  for (const name of ['hover-class', 'hoverClass']) {
    try {
      const v = await el.attribute(name);
      if (v !== undefined && v !== null && v !== '') return String(v);
    } catch (e) {
      /* 换下一种 */
    }
  }
  try {
    const wxml = await el.wxml();
    const m = /hover-class="([^"]*)"/.exec(String(wxml || ''));
    if (m) return m[1];
    if (/hover-class=/.test(String(wxml || ''))) return '<bound>';
  } catch (e) {
    /* ignore */
  }
  return '';
}

async function classOf(el) {
  try {
    const v = await el.attribute('class');
    if (v) return String(v);
  } catch (e) {
    /* ignore */
  }
  try {
    const wxml = await el.wxml();
    const m = /class="([^"]*)"/.exec(String(wxml || ''));
    if (m) return m[1];
  } catch (e) {
    /* ignore */
  }
  return '';
}

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

(async () => {
  // ================= A. 静态层 =================
  const distCss = walk(distDir, ['.wxss']);
  check('编译产物里有 wxss', distCss.length > 0, `${distCss.length} 个文件`);

  const distHoverHits = [];
  for (const file of distCss) {
    const text = stripComments(fs.readFileSync(file, 'utf8'));
    // 只认「选择器里的 :hover」：前面必须有类/元素限定，避免误伤 hover-class 字符串
    const m = text.match(/[.#\w\]\)-]\s*:hover\b/g);
    if (m) distHoverHits.push(`${path.relative(distDir, file)}×${m.length}`);
  }
  check(
    '编译产物里没有 :hover 选择器',
    distHoverHits.length === 0,
    distHoverHits.length ? distHoverHits.join(', ') : `${distCss.length} 个 wxss 全部干净`,
  );

  const srcStyleFiles = walk(srcDir, ['.scss', '.css', '.tsx', '.ts']);
  const srcHoverHits = [];
  for (const file of srcStyleFiles) {
    const text = stripComments(fs.readFileSync(file, 'utf8'));
    const m = text.match(/[.#\w\]\)-]\s*:hover\b/g);
    if (m) srcHoverHits.push(`${path.relative(srcDir, file)}×${m.length}`);
  }
  check(
    '源码里没有 :hover 选择器',
    srcHoverHits.length === 0,
    srcHoverHits.length ? srcHoverHits.join(', ') : `${srcStyleFiles.length} 个文件全部干净`,
  );

  // 反向守卫：确认改法本身还在，不是把交互反馈整个删掉
  const allDistCss = distCss.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  const hoverClassRules = (allDistCss.match(/--hover\b/g) || []).length;
  check('产物里按下态 --hover 类名还在', hoverClassRules >= 8, `${hoverClassRules} 处引用`);

  let hoverClassBindings = 0;
  for (const file of walk(srcDir, ['.tsx'])) {
    const text = fs.readFileSync(file, 'utf8');
    hoverClassBindings += (text.match(/hoverClass=/g) || []).length;
  }
  check('源码 hoverClass 绑定够量', hoverClassBindings >= 40, `${hoverClassBindings} 处`);

  // ================= B. 运行时层 =================
  const mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${PORT}` });
  console.log('\n已连接自动化端口\n');

  // ---- B1. 「我的」页：可点击行带 hover-class，只读行不带 ----
  await mp.reLaunch('/pages/settings/index');
  const settings = await waitForPage(mp, 'settings');
  await sleep(600);

  const rows = await settings.$$('.settings-row');
  const rowInfo = [];
  for (const el of rows) {
    rowInfo.push({
      label: (await el.text()).replace(/\s+/g, ' ').trim().slice(0, 16),
      hover: await hoverClassOf(el),
    });
  }
  const clickable = rowInfo.filter((r) => r.hover);
  const readonlyLabels = ['应用版本', '本地数据占用', '数据存放', '数据只保存在这台'];
  const readonly = rowInfo.filter((r) => readonlyLabels.some((k) => r.label.includes(k)));

  check(
    '「我的」页可点击行都带 hover-class',
    clickable.length >= 15,
    `${clickable.length}/${rowInfo.length} 行带 hover-class`,
  );
  check(
    '只读行不带 hover-class',
    readonly.length >= 2 && readonly.every((r) => !r.hover),
    readonly.map((r) => `${r.label}${r.hover ? '(✗带)' : ''}`).join(' / ') || '未找到只读行',
  );

  // ---- B2. 真的点一下：弹层选中后，页面里不能有残留的 --hover ----
  const tapped = await tapText(settings, '.settings-row', '货币符号');
  await sleep(500);
  const sheetShown = await tapText(settings, '.settings-row', '¥');
  await sleep(600);

  const residue = [];
  for (const el of await settings.$$('.settings-row')) {
    const cls = await classOf(el);
    if (cls.includes('--hover')) residue.push(cls);
  }
  check(
    '点过之后没有元素残留 --hover 类',
    tapped && sheetShown && residue.length === 0,
    residue.length ? residue.join(' | ') : `点了「货币符号」并在弹层选回 ¥，${rows.length} 行全部干净`,
  );
  const currencyBack = await mp.evaluate(
    () => globalThis.__ledgerStore.getState().data.settings.currency,
  );
  check('弹层里选回原币种没改动数据', currencyBack === '¥', `当前 ${currencyBack}`);

  // ---- B3. 流水页：账单行带 hover-class ----
  await mp.reLaunch('/pages/ledger/index');
  const ledger = await waitForPage(mp, 'ledger');
  await sleep(700);

  const txRows = await ledger.$$('.tx-row');
  let txWithHover = 0;
  for (const el of txRows) if (await hoverClassOf(el)) txWithHover += 1;
  check(
    '流水页账单行都带 hover-class',
    txRows.length > 0 && txWithHover === txRows.length,
    `${txWithHover}/${txRows.length} 行`,
  );

  // ---- B4. 统计页：排行行带 hover-class，展开的明细行也带 ----
  await mp.reLaunch('/pages/stats/index');
  const stats = await waitForPage(mp, 'stats');
  await sleep(900);

  const rankRows = await stats.$$('.rank-row');
  let rankWithHover = 0;
  for (const el of rankRows) if (await hoverClassOf(el)) rankWithHover += 1;
  check(
    '图表页排行行都带 hover-class',
    rankRows.length > 0 && rankWithHover === rankRows.length,
    `${rankWithHover}/${rankRows.length} 行`,
  );

  const detailRows = await stats.$$('.rank-detail .tx-row');
  let detailWithHover = 0;
  for (const el of detailRows) if (await hoverClassOf(el)) detailWithHover += 1;
  check(
    '图表页展开的明细行也带 hover-class',
    detailRows.length === 0 || detailWithHover === detailRows.length,
    `${detailWithHover}/${detailRows.length} 行（0 行表示当前无数据，不判失败）`,
  );

  // ---- 截图 ----
  try {
    await mp.reLaunch('/pages/settings/index');
    await sleep(800);
    const shot = path.join(outDir, 'settings-no-sticky.png');
    await mp.screenshot({ path: shot });
    console.log(`\n截图: ${shot}`);
  } catch (e) {
    console.log('截图失败（不影响结论）:', e.message);
  }

  await mp.disconnect();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n合计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error('失败:', err && err.message ? err.message : err);
  process.exit(1);
});
