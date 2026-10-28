/**
 * 把模拟器导到指定页面，供窗口截图使用。
 * 用法：ROUTE=/pages/record/index node scripts/goto.cjs
 */
const automator = require('miniprogram-automator');

const PORT = process.env.AUTO_PORT || '9420';
const ROUTE = process.env.ROUTE || '/pages/home/index';
const WAIT = Number(process.env.WAIT || 1500);

(async () => {
  const mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${PORT}` });
  const page = await mp.reLaunch(ROUTE);
  await page.waitFor(WAIT);
  const cur = await mp.currentPage();
  console.log('当前页面:', cur.path);
  await mp.disconnect();
})().catch((err) => {
  console.error('失败:', err && err.message ? err.message : err);
  process.exit(1);
});
