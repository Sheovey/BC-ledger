/**
 * 调试用：尝试打开指定页面，并打印完整错误详情。
 */
const automator = require('miniprogram-automator');

const PORT = process.env.AUTO_PORT || '9420';
const ROUTE = process.env.ROUTE || '/pages/icons/index';

(async () => {
  const mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${PORT}` });
  console.log('已连接');

  try {
    const page = await mp.reLaunch(ROUTE);
    console.log('reLaunch 成功, path =', page.path);
  } catch (e) {
    console.log('reLaunch 失败');
    console.log('  message:', e && e.message);
    console.log('  errMsg :', e && e.errMsg);
    console.log('  code   :', e && e.code);
    if (e && typeof e === 'object') {
      console.log('  自有属性:', Object.getOwnPropertyNames(e).join(', '));
      try {
        console.log('  JSON   :', JSON.stringify(e));
      } catch (_) {
        console.log('  (无法序列化)');
      }
    }

    // 退一步：先看当前页面在哪
    try {
      const cur = await mp.currentPage();
      console.log('当前页面:', cur && cur.path);
    } catch (e2) {
      console.log('取当前页面也失败:', e2 && e2.message);
    }
  }

  await mp.disconnect();
})().catch((err) => {
  console.error('外层失败:', err && (err.message || err));
  process.exit(1);
});
