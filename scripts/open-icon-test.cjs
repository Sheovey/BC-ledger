/**
 * 打开图标方案测试页并检查节点是否渲染出来。
 * 前提：cli.bat auto --project <项目> --auto-port 9420 已运行
 */
const automator = require('miniprogram-automator');

const PORT = process.env.AUTO_PORT || '9420';
const ROUTE = process.env.ROUTE || '/pages/icon-test/index';

(async () => {
  const mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${PORT}` });
  console.log('已连接');

  const page = await mp.reLaunch(ROUTE);
  await page.waitFor(3000);

  const cur = await mp.currentPage();
  console.log('当前页面:', cur.path);

  const selects = ['.page', '.row', '.ico', '.ico-mask', '.ico-bg', '.ico-fixed'];
  for (const sel of selects) {
    const els = await cur.$$(sel);
    console.log(`  ${sel.padEnd(12)} 节点数: ${els.length}`);
  }

  const labels = await cur.$$('.label');
  const texts = [];
  for (const el of labels) texts.push(await el.text());
  console.log('行标签:', texts.join(' | '));

  await mp.disconnect();
  console.log('完成');
})().catch((err) => {
  console.error('失败:', err && err.message ? err.message : err);
  process.exit(1);
});
