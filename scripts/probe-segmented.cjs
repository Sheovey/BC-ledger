/**
 * 临时探查：流水页四段筛选是否等宽、区间激活后最长标签会不会被裁。
 * 用法：node scripts/probe-segmented.cjs
 */
const automator = require('miniprogram-automator');
const path = require('path');
const fs = require('fs');

const PORT = process.env.AUTO_PORT || '9420';
const outDir = path.join(__dirname, '..', 'preview');
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const measure = async (page) => {
  const out = [];
  for (const el of await page.$$('.segmented__item')) {
    out.push({ text: (await el.text()).trim(), box: await el.offset() });
  }
  return out;
};

(async () => {
  const mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${PORT}` });
  await mp.reLaunch('/pages/ledger/index');
  await sleep(1500);
  const page = await mp.currentPage();

  const rows = await measure(page);
  console.log('=== 未激活区间 ===');
  rows.forEach((r) =>
    console.log(`  ${r.text.padEnd(12)} left=${r.box.left} width=${r.box.width}`),
  );
  const widths = rows.map((r) => r.box.width);
  const spread = Math.max(...widths) - Math.min(...widths);
  console.log(`  宽度极差 = ${spread.toFixed(2)}px`);

  await mp.screenshot({ path: path.join(outDir, 'seg-before.png') });

  // 打开区间弹层，直接确定（默认起止月份即当前月，标签为 11 字符，等同最长情况）
  for (const el of await page.$$('.segmented__item')) {
    if ((await el.text()).trim() === '区间') {
      await el.tap();
      break;
    }
  }
  await sleep(800);
  for (const el of await page.$$('.range-sheet__actions .btn')) {
    if ((await el.text()).trim() === '确定') {
      await el.tap();
      break;
    }
  }
  await sleep(1000);

  const after = await measure(page);
  console.log('\n=== 区间激活后 ===');
  after.forEach((r) =>
    console.log(`  ${r.text.padEnd(12)} left=${r.box.left} width=${r.box.width}`),
  );
  const w2 = after.map((r) => r.box.width);
  console.log(`  宽度极差 = ${(Math.max(...w2) - Math.min(...w2)).toFixed(2)}px`);
  const rangeText = after.find((r) => r.text.includes('-'));
  console.log(`  区间标签 = "${rangeText ? rangeText.text : '未找到'}"（${rangeText ? rangeText.text.length : 0} 字符）`);

  await mp.screenshot({ path: path.join(outDir, 'seg-after.png') });
  await mp.disconnect();
})().catch((err) => {
  console.error('失败:', err && err.message ? err.message : err);
  process.exit(1);
});
