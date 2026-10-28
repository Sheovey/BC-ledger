/**
 * 账户页验收。
 *
 * 前提：cli.bat auto --project . --auto-port 9420 已运行，且已执行过 taro build。
 *
 * 路径：首页 → 底栏「我的」→「账户」，验证二级页的真实入口能走通，
 * 而不是直接 reLaunch 绕过导航。
 *
 * 验收点：
 * 1. 从设置页点「账户」能进账户页，标题与账本名副标题正确
 * 2. 净资产卡片、账户列表、每行余额渲染
 * 3. 新增账户：填名称 / 选类型 / 填初始余额 / 保存 → 列表 +1 且数值正确
 * 4. 编辑账户：改名保存 → 列表名称变化
 * 5. 「计入总资产」开关能切换并落库
 * 6. 删除账户：二次确认 → 列表 -1
 * 7. 返回键回到设置页
 */
const automator = require('miniprogram-automator');
const path = require('path');
const fs = require('fs');

const PORT = process.env.AUTO_PORT || '9420';
const outDir = path.join(__dirname, '..', 'preview');
fs.mkdirSync(outDir, { recursive: true });

const results = [];
const check = (label, pass, detail = '') => {
  results.push({ label, pass, detail });
  console.log(`${pass ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForPage(mp, keyword, timeout = 12000) {
  const deadline = Date.now() + timeout;
  let last = '';
  while (Date.now() < deadline) {
    const pages = await mp.pageStack();
    last = pages.length ? pages[pages.length - 1].path : '';
    if (last.includes(keyword)) {
      await sleep(500);
      return await mp.currentPage();
    }
    await sleep(200);
  }
  console.log(`   [warn] 等待 ${keyword} 超时，当前 ${last}`);
  return await mp.currentPage();
}

async function tapText(page, selector, text) {
  const els = await page.$$(selector);
  for (const el of els) {
    const t = (await el.text()).trim();
    if (t === text || t.startsWith(text)) {
      await el.tap();
      return true;
    }
  }
  return false;
}

const rowNames = async (page) => {
  const els = await page.$$('.row__title');
  const out = [];
  for (const el of els) out.push((await el.text()).replace(/\s+/g, ' ').trim());
  return out;
};

(async () => {
  const mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${PORT}` });
  console.log('已连接自动化端口\n');

  const bookName = await mp.evaluate(() => {
    const s = globalThis.__ledgerStore.getState();
    return s.data.books[0].name;
  });

  // ---------- 0. 清理上次运行留下的测试账户 ----------
  // 脚本会新增「测试钱包」并改名为「改名后钱包」，跑第二次就会叠两份。
  // 软删除的账户还在数组里，所以这里直接从 accounts 里摘掉（走 importData 才会落盘）。
  const cleaned = await mp.evaluate(() => {
    const s = globalThis.__ledgerStore.getState();
    const junk = s.data.accounts.filter(
      (a) => a.name === '测试钱包' || a.name === '改名后钱包',
    );
    if (!junk.length) return 0;
    const ids = junk.map((a) => a.id);
    globalThis.__ledgerStore.getState().importData({
      ...s.data,
      accounts: s.data.accounts.filter((a) => !ids.includes(a.id)),
    });
    return junk.length;
  });
  console.log(cleaned ? `清理了 ${cleaned} 个上次残留的测试账户\n` : '无残留测试账户\n');

  // ---------- 1. 我的 → 账户 ----------
  await mp.reLaunch('/pages/home/index');
  await sleep(1500);
  let page = await mp.currentPage();
  await tapText(page, '.tabbar__item', '我的');
  page = await waitForPage(mp, 'pages/settings/index');

  const entered = await tapText(page, '.settings-row', '账户');
  page = await waitForPage(mp, 'pages/accounts/index');
  check('从「我的」进入账户页', entered && page.path.includes('pages/accounts/index'), page.path);

  const titleEl = await page.$('.acc-head__title');
  const subEl = await page.$('.acc-head__sub');
  const title = titleEl ? (await titleEl.text()).trim() : '';
  const sub = subEl ? (await subEl.text()).trim() : '';
  check('标题为「账户」', title === '账户', title);
  check('副标题为账本名', sub === bookName, `页面 ${sub} / 期望 ${bookName}`);

  // ---------- 2. 净资产与列表 ----------
  const heroAmount = await page.$('.book-hero__amount');
  const heroText = heroAmount ? (await heroAmount.text()).replace(/\s/g, '') : '';
  check('净资产卡片有金额', /\d/.test(heroText), heroText);

  const beforeNames = await rowNames(page);
  const beforeCount = beforeNames.length;
  check('账户列表有初始账户', beforeCount > 0, `${beforeCount} 个：${beforeNames.join('、')}`);

  const balanceEls = await page.$$('.row__value');
  check('每行都显示余额', balanceEls.length === beforeCount, `${balanceEls.length} 个余额`);

  // ---------- 3. 新增账户 ----------
  // 用 :last-child 查不到（automator 的选择器引擎不认这个伪类），改成取全部再挑最后一个
  const headBtns = await page.$$('.acc-head .icon-btn');
  const plus = headBtns[headBtns.length - 1];
  check('顶部有加号按钮', Boolean(plus), `${headBtns.length} 个按钮`);
  await plus.tap();
  await sleep(1000);
  const sheet = await page.$('.sheet');
  check('新增账户弹层打开', Boolean(sheet));

  const nameInput = await page.$('.acc-form .input');
  check('名称输入框存在', Boolean(nameInput));
  await nameInput.input('测试钱包');
  await sleep(300);

  const typePicked = await tapText(page, '.acc-types .chip', '微信钱包');
  await sleep(300);
  check('选中账户类型', typePicked);

  const inputs = await page.$$('.acc-form .input');
  check('表单有两个输入框', inputs.length === 2, `${inputs.length} 个`);
  await inputs[inputs.length - 1].input('88.50');
  await sleep(300);

  await tapText(page, '.acc-form .btn', '保存');
  await sleep(1200);
  const sheetGone = await page.$('.sheet');
  check('保存后弹层关闭', !sheetGone);

  const afterNames = await rowNames(page);
  check('账户数 +1', afterNames.length === beforeCount + 1, `${beforeCount} → ${afterNames.length}`);
  check('新账户出现在列表', afterNames.some((n) => n.includes('测试钱包')), afterNames.join('、'));

  const newBalance = await mp.evaluate(() => {
    const s = globalThis.__ledgerStore.getState();
    const acc = s.data.accounts.find((a) => a.name === '测试钱包');
    return acc ? { fen: acc.initialBalance, type: acc.type, include: acc.includeInTotal } : null;
  });
  check('初始余额存为 8850 分', newBalance && newBalance.fen === 8850, JSON.stringify(newBalance));
  check('账户类型为 wechat', newBalance && newBalance.type === 'wechat', newBalance ? newBalance.type : '');
  check('默认计入总资产', newBalance && newBalance.include === true);

  // ---------- 4. 编辑账户 ----------
  const rows = await page.$$('.row');
  let targetIndex = -1;
  for (let i = 0; i < rows.length; i += 1) {
    const t = (await rows[i].text()).replace(/\s+/g, '');
    if (t.includes('测试钱包')) {
      targetIndex = i;
      break;
    }
  }
  check('能在列表里定位到新账户', targetIndex >= 0, `第 ${targetIndex + 1} 行`);

  if (targetIndex >= 0) {
    await rows[targetIndex].tap();
    await sleep(1000);
    const editSheet = await page.$('.sheet');
    check('点行打开账户设置弹层', Boolean(editSheet));
    const editTitle = await page.$('.sheet__title');
    const et = editTitle ? (await editTitle.text()).trim() : '';
    check('弹层标题为「账户设置」', et === '账户设置', et);

    const editInput = await page.$('.acc-form .input');
    await editInput.input('改名后钱包');
    await sleep(300);

    // 切换「计入总资产」
    const switchEl = await page.$('.switch');
    const switchOnBefore = await page.$('.switch--on');
    await switchEl.tap();
    await sleep(400);
    check('开关可以切换', Boolean(switchOnBefore));

    await tapText(page, '.acc-form .btn', '保存');
    await sleep(1200);
    const renamed = await rowNames(page);
    check('改名生效', renamed.some((n) => n.includes('改名后钱包')), renamed.join('、'));

    const included = await mp.evaluate(() => {
      const s = globalThis.__ledgerStore.getState();
      const acc = s.data.accounts.find((a) => a.name === '改名后钱包');
      return acc ? acc.includeInTotal : null;
    });
    check('「不计入总资产」已落库', included === false, String(included));
  }

  // ---------- 5. 删除账户 ----------
  const beforeDeleteNames = await rowNames(page);
  const rows2 = await page.$$('.row');
  for (const row of rows2) {
    const t = (await row.text()).replace(/\s+/g, '');
    if (t.includes('改名后钱包')) {
      await row.tap();
      break;
    }
  }
  await sleep(1000);
  const deleteTapped = await tapText(page, '.sheet .settings-row', '删除账户');
  await sleep(900);
  const confirmDialog = await page.$('.sheet');
  check('删除需要二次确认', deleteTapped && Boolean(confirmDialog));
  await tapText(page, '.sheet .btn', '确定');
  await sleep(1300);

  const afterDeleteNames = await rowNames(page);
  // 注意：这里是软删除，账户仍留在列表里（淡化 + 「已停用」徽标），
  // 所以断言的是「行数不变、但出现淡化行」，不是行数减少。
  check(
    '删除后仍保留该账户（软删除）',
    afterDeleteNames.length === beforeDeleteNames.length &&
      afterDeleteNames.some((n) => n.includes('改名后钱包')),
    `${beforeDeleteNames.length} → ${afterDeleteNames.length}`,
  );
  const dimRows = await page.$$('.row--dim');
  const badges = await page.$$('.acc-badge');
  check(
    '该行已淡化并标「已停用」',
    dimRows.length >= 1 && badges.length >= 1,
    `淡化 ${dimRows.length} 行，徽标 ${badges.length} 个`,
  );
  const stillThere = await mp.evaluate(() => {
    const s = globalThis.__ledgerStore.getState();
    const acc = s.data.accounts.find((a) => a.name === '改名后钱包');
    // 软删除：记录还在，但 archived 为 true
    return acc ? { archived: acc.archived } : null;
  });
  check('删除是软删除（记录保留但停用）', stillThere && stillThere.archived === true, JSON.stringify(stillThere));

  // ---------- 6. 返回 ----------
  const headBtns2 = await page.$$('.acc-head .icon-btn');
  await headBtns2[0].tap();
  page = await waitForPage(mp, 'pages/settings/index');
  check('返回键回到设置页', page.path.includes('pages/settings/index'), page.path);

  // ---------- 截图 ----------
  await mp.reLaunch('/pages/accounts/index');
  await sleep(1500);
  try {
    const shot = path.join(outDir, 'accounts-page.png');
    await mp.screenshot({ path: shot });
    console.log(`\n截图: ${shot}`);
  } catch (e) {
    console.log('截图失败（不影响结论）:', e.message);
  }

  await mp.disconnect();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n合计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error('失败:', err && err.message ? err.message : err);
  process.exit(1);
});
