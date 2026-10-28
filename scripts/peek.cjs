/**
 * 交互探针：把模拟器导到某个中间态，便于用窗口截图看真实样式。
 * 用法：STEP=category|time|amount|edit node scripts/peek.cjs
 */
const automator = require('miniprogram-automator');

const PORT = process.env.AUTO_PORT || '9420';
const STEP = process.env.STEP || 'category';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${PORT}` });
  await mp.reLaunch('/pages/record/index');
  await sleep(1800);
  const page = await mp.currentPage();
  console.log('页面:', page.path);

  const tapKey = async (text) => {
    const keys = await page.$$('.key');
    for (const k of keys) {
      if ((await k.text()).trim() === text) {
        await k.tap();
        return;
      }
    }
  };

  if (STEP === 'amount') {
    for (const k of ['1', '2', '.', '5']) await tapKey(k);
    await sleep(400);
  }

  if (STEP === 'category') {
    for (const k of ['1', '2', '.', '5']) await tapKey(k);
    await sleep(300);
    const fields = await page.$$('.record__field');
    await fields[0].tap();
    await sleep(900);
    const roots = await page.$$('.cat-item');
    console.log('分类弹层根节点:', roots.length);
  }

  if (STEP === 'time') {
    const fields = await page.$$('.record__field');
    await fields[1].tap();
    await sleep(900);
    const inputs = await page.$$('.time-sheet__cell');
    console.log('时间选择格子:', inputs.length);
  }

  console.log('STEP 完成:', STEP);
  await mp.disconnect();
})().catch((err) => {
  console.error('失败:', err && err.message ? err.message : err);
  process.exit(1);
});
