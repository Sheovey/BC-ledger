/**
 * 连接微信开发者工具的自动化端口，打开首页并截图。
 * 前提：先执行 cli.bat auto --project <项目> --auto-port 9420
 */
const automator = require('miniprogram-automator');
const path = require('path');
const fs = require('fs');

const PORT = process.env.AUTO_PORT || '9420';

(async () => {
  const outDir = path.join(__dirname, '..', 'preview');
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`连接 ws://127.0.0.1:${PORT} ...`);
  const mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${PORT}` });
  console.log('已连接模拟器');

  const page = await mp.reLaunch('/pages/index/index');
  await page.waitFor(2500);

  const cur = await mp.currentPage();
  console.log('当前页面:', cur.path);

  const data = await cur.data();
  console.log('页面 data 键:', Object.keys(data || {}).join(', '));
  console.log('data 预览:', JSON.stringify(data || {}).slice(0, 400));

  const shotPath = path.join(outDir, 'weapp-home.png');
  await mp.screenshot({ path: shotPath });
  const size = fs.statSync(shotPath).size;
  console.log(`截图已保存: ${shotPath} (${(size / 1024).toFixed(1)} KB)`);

  await mp.disconnect();
  console.log('完成');
})().catch((err) => {
  console.error('失败:', err && err.message ? err.message : err);
  process.exit(1);
});
