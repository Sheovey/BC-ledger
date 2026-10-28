const automator = require('miniprogram-automator');

const race = (p, ms, label) =>
  Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} 超时 ${ms}ms`)), ms)),
  ]);

(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
  console.log('已连接');

  try {
    const r1 = await race(mp.evaluate(function () { return 1 + 1; }), 15000, '基础 evaluate');
    console.log('基础 evaluate:', r1);
  } catch (e) {
    console.log('基础 evaluate 失败:', e.message);
  }

  try {
    const r2 = await race(
      mp.evaluate(function () { return typeof globalThis.__ledgerStore; }),
      15000,
      'store 探测',
    );
    console.log('__ledgerStore 类型:', r2);
  } catch (e) {
    console.log('store 探测失败:', e.message);
  }

  await mp.disconnect();
})().catch((e) => {
  console.error('外层失败:', e.message);
  process.exit(1);
});
