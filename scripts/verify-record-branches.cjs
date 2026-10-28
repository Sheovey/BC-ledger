/**
 * 记账页支路验收：编辑已有记录 / 删除 / 余额调整模式。
 *
 * 前提：cli.bat auto --project . --auto-port 9420 已运行，且已执行过 taro build。
 *
 * 与 verify-record.cjs 的分工：那个验主链路（新增 → 回首页），
 * 这个验三处容易在迁移中漏掉的差异逻辑：
 * 1. 带 txId 进入时应是「编辑记录」态：标题、按钮文案、删除入口
 * 2. 删除要二次确认，删完回首页且条数 -1
 * 3. 余额模式的输入是「目标余额」而不是金额，保存时存的是差额
 */
const automator = require('miniprogram-automator');
const path = require('path');

const PORT = process.env.AUTO_PORT || '9420';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (label, pass, detail = '') => {
  results.push({ label, pass });
  console.log(`${pass ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
};

const countTxs = (mp) =>
  mp.evaluate(() => {
    const s = globalThis.__ledgerStore.getState();
    const book = s.data.books[0];
    return s.data.txs.filter((t) => t.bookId === book.id).length;
  });

/** 按文字点元素：按下标取按钮在布局变动后容易点错（比如点到「取消」） */
async function tapByText(page, selector, text) {
  const els = await page.$$(selector);
  for (const el of els) {
    if ((await el.text()).trim() === text) {
      await el.tap();
      return true;
    }
  }
  return false;
}

/**
 * 等页面切换到位再继续。
 * 固定 sleep 会偶发踩空：navigateTo 动画期间 currentPage 仍返回旧页，
 * 后续按元素就全是 null，看起来像「功能坏了」其实是时序问题。
 */
async function waitForPage(mp, keyword, timeout = 15000) {
  const deadline = Date.now() + timeout;
  let last = '';
  while (Date.now() < deadline) {
    // 用 currentPage 而不是 pageStack：reLaunch 之后 pageStack 的缓存会滞后一轮，
    // 实测会一直读到旧栈顶，误判成「没跳转」。
    const cur = await mp.currentPage();
    last = cur ? cur.path : '';
    if (last.includes(keyword)) {
      await sleep(400);
      return await mp.currentPage();
    }
    await sleep(200);
  }
  // 超时不抛错：把当前页原样返回，交给后面的 check 报告真实路径，
  // 否则脚本会中断、后面的数据层断言根本没机会执行。
  console.log(`   [warn] 等待 ${keyword} 超时，当前页面 ${last}`);
  return await mp.currentPage();
}

(async () => {
  const mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${PORT}` });
  // 抓逻辑层 warn/error：路由失败现在会 warn，这是定位「点了没反应」的唯一线索
  mp.on('console', (msg) => {
    if (msg.type === 'warn' || msg.type === 'error') {
      const text = (msg.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
      console.log(`   [${msg.type}] ${text}`.slice(0, 300));
    }
  });
  await mp.reLaunch('/pages/home/index');
  await sleep(1500);
  let page = await mp.currentPage();

  // 先播种：前面几轮测试可能把数据删空了，靠残留状态跑支路会假失败。
  // 直接调 store action 建一条，路径与用户点保存完全一致（走同一套 addTx）。
  const seeded = await mp.evaluate(() => {
    const s = globalThis.__ledgerStore.getState();
    const book = s.data.books[0];
    if (!book) return { ok: false, reason: 'no-book' };
    const before = s.data.txs.filter((t) => t.bookId === book.id).length;
    if (before > 0) return { ok: true, before, added: false };
    const acc = s.data.accounts.filter((a) => a.bookId === book.id && !a.archived)[0];
    const cat = s.data.categories.filter((c) => c.type === 'expense' && !c.archived)[0];
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const at = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    s.addTx({
      bookId: book.id,
      type: 'expense',
      amount: 1000,
      categoryId: cat ? cat.id : null,
      accountId: acc ? acc.id : null,
      toAccountId: null,
      projectId: null,
      merchant: '',
      note: 'e2e 播种',
      occurredAt: at,
    });
    return { ok: true, before, added: true };
  });
  console.log('播种:', JSON.stringify(seeded));
  await sleep(800);

  page = await mp.currentPage();
  const start = await countTxs(mp);
  console.log('起始流水条数:', start, '\n');

  // ---------- 1. 进编辑态 ----------
  const rows = await page.$$('.tx-row');
  check('首页有可编辑流水', rows.length > 0, `${rows.length} 行`);
  if (!rows.length) {
    await mp.disconnect();
    process.exit(1);
  }
  await rows[0].tap();
  page = await waitForPage(mp, 'pages/record');
  check('点流水进入记账页', page.path.includes('pages/record/index'), page.path);

  const title = await page.$('.record__title');
  check('标题为编辑记录', (await title.text()).trim() === '编辑记录', (await title.text()).trim());

  const save = await page.$('.record__save');
  check('按钮文案为更新', (await save.text()).trim() === '更新', (await save.text()).trim());

  const amount = await page.$('.record__amount');
  check('金额已回填', (await amount.text()).trim() !== '0.00', (await amount.text()).trim());

  const delBtn = await page.$('.record__delete');
  check('存在删除入口', Boolean(delBtn));

  // ---------- 2. 删除二次确认 ----------
  await delBtn.tap();
  // 弹层有 240ms 的升起动画，动画没走完就取坐标会点偏（实测会误触取消）
  await sleep(1000);
  const dialogTitle = await page.$('.sheet__title');
  const dialogText = dialogTitle ? (await dialogTitle.text()).trim() : '';
  check('删除有二次确认', dialogText.includes('删除'), dialogText);

  const dialogBtns = await page.$$('.sheet .btn');
  check('确认弹层有两个按钮', dialogBtns.length === 2, `${dialogBtns.length} 个`);
  const hit = await tapByText(page, '.sheet .btn', '确定');
  check('点到确定按钮', hit);
  page = await waitForPage(mp, 'pages/home');
  await sleep(600);
  const afterDelete = await countTxs(mp);
  check('删除后回到首页', page.path.includes('pages/home/index'), page.path);
  check('删除后条数 -1', afterDelete === start - 1, `${start} → ${afterDelete}`);

  // ---------- 3. 余额调整 ----------
  // 回到首页后重新取一次 currentPage：navigateBack 之后旧的 page 句柄已失效，
  // 在失效句柄上查 .tabbar__add 会拿到 null，表现为「点了没反应」的假故障。
  await sleep(1200);
  page = await mp.currentPage();
  const addBtn = await page.$('.tabbar__add');
  check('首页有记一笔入口', Boolean(addBtn));
  if (!addBtn) {
    await mp.disconnect();
    process.exit(1);
  }
  await addBtn.tap();
  page = await waitForPage(mp, 'pages/record');

  // 左侧类型列里点「余额」
  const types = await page.$$('.keypad__type');
  let tapped = false;
  for (const t of types) {
    if ((await t.text()).trim() === '余额') {
      await t.tap();
      tapped = true;
      break;
    }
  }
  check('切换到余额模式', tapped);
  await sleep(500);

  const hint = await page.$('.record__hint');
  const hintText = hint ? (await hint.text()).trim() : '';
  check('余额模式显示当前余额提示', hintText.includes('当前余额'), hintText);

  // 记录保存前的账户余额，用于校验「存的是差额」
  const balanceBefore = await mp.evaluate(() => {
    const s = globalThis.__ledgerStore.getState();
    const book = s.data.books[0];
    const acc = s.data.accounts.filter((a) => a.bookId === book.id && !a.archived)[0];
    const txs = s.data.txs.filter((t) => t.bookId === book.id);
    // 必须用页面同一个实现算基准：手写 reduce 会漏掉 account.initialBalance，
    // 导致「期望差额」从一开始就是错的（踩过一次）。
    const fn = globalThis.__ledgerAccountBalance;
    if (typeof fn === 'function') return fn(acc, txs);
    let sum = acc && typeof acc.initialBalance === 'number' ? acc.initialBalance : 0;
    for (const t of txs) {
      if (t.type === 'transfer') {
        if (t.accountId === acc.id) sum -= t.amount;
        else if (t.toAccountId === acc.id) sum += t.amount;
        continue;
      }
      if (t.accountId !== acc.id) continue;
      if (t.type === 'income' || t.type === 'balance') sum += t.amount;
      else if (t.type === 'expense') sum -= t.amount;
    }
    return sum;
  });
  console.log('   保存前账户余额(分):', balanceBefore);

  // 目标余额必须与当前余额不同，否则会命中「余额没有变化」分支。
  // 用「当前余额 + 5.00」作为目标，期望差额恒为 500 分，不受历史数据影响。
  const targetYuan = ((balanceBefore + 500) / 100).toFixed(2).replace(/\.00$/, '');
  console.log('   目标余额(元):', targetYuan, '期望差额(分): 500');
  for (const k of targetYuan.split('')) {
    const keys = await page.$$('.key');
    for (const el of keys) {
      if ((await el.text()).trim() === k) {
        await el.tap();
        break;
      }
    }
  }
  await sleep(400);

  const save2 = await page.$('.record__save');
  await save2.tap();
  page = await waitForPage(mp, 'pages/home');
  await sleep(600);
  const afterBalance = await countTxs(mp);
  check('余额调整写入一条', afterBalance === afterDelete + 1, `${afterDelete} → ${afterBalance}`);

  const lastTx = await mp.evaluate(() => {
    const s = globalThis.__ledgerStore.getState();
    const book = s.data.books[0];
    const txs = s.data.txs.filter((t) => t.bookId === book.id);
    // addTx 插在数组头部，取最新必须按 createdAt 排，不能取末位
    const t = [...txs].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
    return { type: t.type, amount: t.amount, note: t.note };
  });
  check('类型为 balance', lastTx.type === 'balance', JSON.stringify(lastTx));
  check(
    '存的是差额（目标余额 - 原余额）',
    lastTx.amount === 500,
    `期望 500 分，实际 ${lastTx.amount} 分`,
  );
  check('备注自动记为余额调整', lastTx.note === '余额调整', lastTx.note);

  await mp.disconnect();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n合计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error('失败:', err && err.message ? err.message : err);
  process.exit(1);
});
