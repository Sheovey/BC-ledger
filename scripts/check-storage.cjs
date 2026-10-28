/**
 * 检查小程序端的存储状态：persist 是否真的用了 wx.storage 写入。
 */
const automator = require('miniprogram-automator');

const PORT = process.env.AUTO_PORT || '9420';

(async () => {
  const mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${PORT}` });
  console.log('已连接');

  const info = await mp.callWxMethod('getStorageInfoSync');
  console.log('存储概况:', JSON.stringify(info));

  const keys = (info && info.keys) || [];
  console.log(`key 数量: ${keys.length}`);
  for (const k of keys) console.log('  -', k);

  // 逐个读一下，确认内容形态
  for (const k of keys) {
    try {
      const v = await mp.callWxMethod('getStorageSync', k);
      const text = typeof v === 'string' ? v : JSON.stringify(v);
      console.log(`\n[${k}] 长度 ${text.length}`);
      console.log('  预览:', text.slice(0, 220).replace(/\s+/g, ' '));
    } catch (e) {
      console.log(`[${k}] 读取失败: ${e.message}`);
    }
  }

  const pages = await mp.callWxMethod('getCurrentPages');
  console.log('\n页面栈深度:', Array.isArray(pages) ? pages.length : '未知');

  await mp.disconnect();
  console.log('\n完成');
})().catch((err) => {
  console.error('失败:', err && err.message ? err.message : err);
  process.exit(1);
});
