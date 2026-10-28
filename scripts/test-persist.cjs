/**
 * 端到端验证小程序端的存储链路：
 *   写入一笔流水 → 检查 wx.storage 是否落盘 → 重启页面 → 确认数据读回
 */
const automator = require('miniprogram-automator');

const PORT = process.env.AUTO_PORT || '9420';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(label, ok, detail) {
  results.push({ label, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

(async () => {
  const mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${PORT}` });
  console.log('已连接\n');
  // 刚连上时逻辑层可能还没完成首屏渲染，直接 evaluate 会超时
  await sleep(1800);

  // 1) 初始状态
  const init = await mp.evaluate(function () {
    const st = globalThis.__ledgerStore;
    if (!st) return { error: 'store 未挂到 globalThis' };
    const s = st.getState();
    return {
      books: s.data.books.length,
      categories: s.data.categories.length,
      accounts: s.data.accounts.length,
      txs: s.data.txs.length,
    };
  });
  console.log('初始状态:', JSON.stringify(init));
  check('store 可从全局访问', !init.error, init.error);
  check('初始数据非空（seed 生效）', init.books > 0 && init.categories > 0, `账本 ${init.books} / 分类 ${init.categories} / 账户 ${init.accounts}`);

  // 2) 写入一笔 12.50 元支出
  const added = await mp.evaluate(function () {
    const st = globalThis.__ledgerStore.getState();
    const book = st.data.books[0];
    const cat = st.data.categories.find((c) => c.type === 'expense' && !c.archived);
    const acc = st.data.accounts.find((a) => !a.archived);
    if (!book || !cat || !acc) return { error: '缺少账本/分类/账户' };
    const id = st.addTx({
      bookId: book.id,
      type: 'expense',
      amount: 1250,
      categoryId: cat.id,
      accountId: acc.id,
      toAccountId: null,
      projectId: null,
      merchant: '自动化测试',
      note: '小程序端持久化验证',
      occurredAt: new Date().toISOString().slice(0, 16),
    });
    return { id, txs: globalThis.__ledgerStore.getState().data.txs.length, cat: cat.name };
  });
  console.log('\n写入结果:', JSON.stringify(added));
  check('addTx 成功', Boolean(added.id), added.error || `分类「${added.cat}」，流水数 ${added.txs}`);

  // 3) 等落盘后检查 storage
  await sleep(1500);
  const info = await mp.callWxMethod('getStorageInfoSync');
  console.log('\n存储概况:', JSON.stringify(info));
  const keys = (info && info.keys) || [];
  check('数据已写入 wx.storage', keys.length > 0, `key: ${keys.join(', ') || '(空)'}`);

  let metaPreview = '';
  if (keys.length) {
    const metaKey = keys.find((k) => k === 'ledger-app.v1') || keys[0];
    const raw = await mp.callWxMethod('getStorageSync', metaKey);
    const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
    metaPreview = text.slice(0, 160);
    console.log(`\n[${metaKey}] 长度 ${text.length}\n  ${metaPreview}`);
  }

  // 4) 重启页面，验证读回
  await mp.reLaunch('/pages/home/index');
  await sleep(2500);

  const reloaded = await mp.evaluate(function () {
    const s = globalThis.__ledgerStore.getState();
    const tx = s.data.txs[0];
    return {
      txs: s.data.txs.length,
      amount: tx ? tx.amount : null,
      note: tx ? tx.note : null,
    };
  });
  console.log('\n重启后状态:', JSON.stringify(reloaded));
  check('重启后流水仍在（持久化生效）', reloaded.txs >= 1, `流水数 ${reloaded.txs}`);
  check('金额未被破坏（1250 分）', reloaded.amount === 1250, `实际 ${reloaded.amount}`);
  check('备注读回正确', reloaded.note === '小程序端持久化验证', `实际「${reloaded.note}」`);

  await mp.disconnect();

  const failed = results.filter((r) => !r.ok);
  console.log('');
  console.log(failed.length ? `结果：${failed.length} 项未通过` : `结果：${results.length} 项全部通过`);
  if (failed.length) process.exitCode = 1;
})().catch((err) => {
  console.error('失败:', err && err.message ? err.message : err);
  process.exit(1);
});
