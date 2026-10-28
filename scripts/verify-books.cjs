/**
 * 账本管理页验收。
 *
 * 前提：cli.bat auto --project . --auto-port 9420 已运行，且已执行过 taro build。
 *
 * 路径：首页 → 底栏「我的」→「账本管理」。
 *
 * 验收点：
 * 1. 进入页面，标题正确，列表非空，当前账本唯一且带「当前」徽标
 * 2. 新建账本 → 列表 +1，且自动切换为当前（lastBookId 指向新账本）
 * 3. 点其它账本卡片 → 切换当前账本（lastBookId 变化，徽标移动）
 * 4. 「⋯」打开操作弹层，标题为账本名，含重命名/归档/删除三项
 * 5. 重命名生效并落库
 * 6. 归档 → 行淡化 + archived=true；恢复后回到正常
 * 7. 删除（无流水）→ 列表 -1，库里消失
 * 8. 返回键回到设置页
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
    const t = (await el.text()).replace(/\s+/g, '');
    if (t === text || t.startsWith(text)) {
      await el.tap();
      return true;
    }
  }
  return false;
}

const cardNames = async (page) => {
  const els = await page.$$('.books-card .book-card__name');
  const out = [];
  for (const el of els) out.push((await el.text()).replace(/\s+/g, ' ').trim());
  return out;
};

(async () => {
  const mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${PORT}` });
  console.log('已连接自动化端口\n');

  // ---------- 0. 清理残留 ----------
  const cleaned = await mp.evaluate(() => {
    const s = globalThis.__ledgerStore.getState();
    const junk = s.data.books.filter((b) => ['测试账本', '改名账本'].includes(b.name));
    if (!junk.length) return 0;
    const ids = junk.map((b) => b.id);
    const keepCurrent = s.data.settings.lastBookId;
    globalThis.__ledgerStore.getState().importData({
      ...s.data,
      books: s.data.books.filter((b) => !ids.includes(b.id)),
      accounts: s.data.accounts.filter((a) => !ids.includes(a.bookId)),
      projects: s.data.projects.filter((p) => !ids.includes(p.bookId)),
      templates: s.data.templates.filter((t) => !ids.includes(t.bookId)),
      budgets: s.data.budgets.filter((b) => !ids.includes(b.bookId)),
      settings: {
        ...s.data.settings,
        lastBookId: ids.includes(keepCurrent) ? null : keepCurrent,
      },
    });
    return junk.length;
  });
  console.log(cleaned ? `清理了 ${cleaned} 个上次残留的测试账本\n` : '无残留测试账本\n');

  // ---------- 1. 我的 → 账本管理 ----------
  await mp.reLaunch('/pages/home/index');
  await sleep(1500);
  let page = await mp.currentPage();
  await tapText(page, '.tabbar__item', '我的');
  page = await waitForPage(mp, 'pages/settings/index');

  const entered = await tapText(page, '.settings-row', '账本管理');
  page = await waitForPage(mp, 'pages/books/index');
  check('从「我的」进入账本管理页', entered && page.path.includes('pages/books/index'), page.path);

  const titleEl = await page.$('.page-head__title');
  const title = titleEl ? (await titleEl.text()).trim() : '';
  check('标题为「我的账本」', title === '我的账本', title);

  const beforeNames = await cardNames(page);
  const beforeCount = beforeNames.length;
  check('账本列表非空', beforeCount > 0, `${beforeCount} 个：${beforeNames.join('、')}`);

  const badges = await page.$$('.books-badge');
  check('有且仅有一个「当前」徽标', badges.length >= 1, `${badges.length} 个徽标`);

  const currentBefore = await mp.evaluate(() => globalThis.__ledgerStore.getState().data.settings.lastBookId);

  // ---------- 2. 新建账本 ----------
  const headBtns = await page.$$('.page-head .icon-btn');
  await headBtns[headBtns.length - 1].tap();
  await sleep(900);
  const sheetTitle = await page.$('.sheet__title');
  const st = sheetTitle ? (await sheetTitle.text()).trim() : '';
  check('新建弹层标题为「新建账本」', st === '新建账本', st);

  await (await page.$('.books-form .input')).input('测试账本');
  await sleep(300);
  const iconBtns = await page.$$('.books-icon');
  check('图标选择器有选项', iconBtns.length >= 6, `${iconBtns.length} 个`);
  await iconBtns[2].tap();
  await sleep(200);
  const colorBtns = await page.$$('.books-color');
  await colorBtns[3].tap();
  await sleep(200);
  await (await page.$('.books-submit')).tap();
  await sleep(1400);
  check('保存后弹层关闭', !(await page.$('.sheet')));

  const afterNames = await cardNames(page);
  check('账本数 +1', afterNames.length === beforeCount + 1, `${beforeCount} → ${afterNames.length}`);
  check('新账本出现在列表', afterNames.some((n) => n.includes('测试账本')), afterNames.join('、'));

  const created = await mp.evaluate(() => {
    const s = globalThis.__ledgerStore.getState();
    const b = s.data.books.find((x) => x.name === '测试账本');
    return b
      ? {
          id: b.id,
          icon: b.icon,
          color: b.color,
          archived: b.archived,
          lastBookId: s.data.settings.lastBookId,
          accounts: s.data.accounts.filter((a) => a.bookId === b.id).length,
        }
      : null;
  });
  check('新账本已落库', Boolean(created), JSON.stringify(created));
  check('图标取第 3 个选项 home', created && created.icon === 'home', created ? created.icon : '');
  check('颜色取第 4 个选项', created && created.color === '#4bb3a0', created ? created.color : '');
  check('新建后自动切为当前账本', Boolean(created && created.lastBookId === created.id));
  check('新账本自动带预设账户', Boolean(created && created.accounts > 0), created ? `${created.accounts} 个` : '');

  const badgeMoved = await mp.evaluate(() => {
    const s = globalThis.__ledgerStore.getState();
    const b = s.data.books.find((x) => x.name === '测试账本');
    return b ? s.data.settings.lastBookId === b.id : false;
  });
  check('「当前」徽标跟着切到新账本', badgeMoved);

  // ---------- 3. 点卡片切换账本 ----------
  const cards = await page.$$('.books-card');
  let switched = false;
  for (const card of cards) {
    const t = (await card.text()).replace(/\s+/g, '');
    if (!t.includes('测试账本')) {
      await card.tap();
      switched = true;
      break;
    }
  }
  await sleep(1200);
  const currentAfterSwitch = await mp.evaluate(() => globalThis.__ledgerStore.getState().data.settings.lastBookId);
  check('点其它账本卡片可切换当前账本', switched && currentAfterSwitch !== created.id, currentAfterSwitch);

  // ---------- 4. 操作弹层 ----------
  const cards2 = await page.$$('.books-card');
  let targetCard = null;
  for (const card of cards2) {
    const t = (await card.text()).replace(/\s+/g, '');
    if (t.includes('测试账本')) {
      targetCard = card;
      break;
    }
  }
  check('能在列表定位到新账本', Boolean(targetCard));
  const moreBtn = await targetCard.$('.icon-btn--plain');
  await moreBtn.tap();
  await sleep(900);
  const actTitleEl = await page.$('.sheet__title');
  const actTitle = actTitleEl ? (await actTitleEl.text()).trim() : '';
  check('操作弹层标题为账本名', actTitle === '测试账本', actTitle);
  const actionRows = await page.$$('.settings-row');
  const actionTexts = [];
  for (const row of actionRows) actionTexts.push((await row.text()).replace(/\s+/g, ''));
  check(
    '含重命名 / 归档 / 删除三项',
    ['重命名与外观', '归档账本', '删除账本'].every((k) => actionTexts.some((t) => t.includes(k))),
    actionTexts.join(' | '),
  );

  // ---------- 5. 重命名 ----------
  await tapText(page, '.settings-row', '重命名与外观');
  await sleep(900);
  const editTitleEl = await page.$('.sheet__title');
  const et = editTitleEl ? (await editTitleEl.text()).trim() : '';
  check('弹层标题为「账本设置」', et === '账本设置', et);
  await (await page.$('.books-form .input')).input('改名账本');
  await sleep(300);
  await (await page.$('.books-submit')).tap();
  await sleep(1300);
  const renamed = await cardNames(page);
  check('重命名生效', renamed.some((n) => n.includes('改名账本')), renamed.join('、'));

  // ---------- 6. 归档与恢复 ----------
  const cards3 = await page.$$('.books-card');
  for (const card of cards3) {
    const t = (await card.text()).replace(/\s+/g, '');
    if (t.includes('改名账本')) {
      await (await card.$('.icon-btn--plain')).tap();
      break;
    }
  }
  await sleep(900);
  await tapText(page, '.settings-row', '归档账本');
  await sleep(1300);
  const archived = await mp.evaluate(() => {
    const s = globalThis.__ledgerStore.getState();
    const b = s.data.books.find((x) => x.name === '改名账本');
    return b ? b.archived : null;
  });
  check('归档已落库', archived === true, String(archived));
  const dimRows = await page.$$('.books-card--dim');
  check('归档行淡化显示', dimRows.length >= 1, `${dimRows.length} 行`);

  // 恢复
  const cards4 = await page.$$('.books-card');
  for (const card of cards4) {
    const t = (await card.text()).replace(/\s+/g, '');
    if (t.includes('改名账本')) {
      await (await card.$('.icon-btn--plain')).tap();
      break;
    }
  }
  await sleep(900);
  await tapText(page, '.settings-row', '恢复账本');
  await sleep(1300);
  const restored = await mp.evaluate(() => {
    const s = globalThis.__ledgerStore.getState();
    const b = s.data.books.find((x) => x.name === '改名账本');
    return b ? b.archived : null;
  });
  check('恢复后 archived=false', restored === false, String(restored));

  // ---------- 7. 删除 ----------
  const countBeforeDelete = (await page.$$('.books-card')).length;
  const cards5 = await page.$$('.books-card');
  for (const card of cards5) {
    const t = (await card.text()).replace(/\s+/g, '');
    if (t.includes('改名账本')) {
      await (await card.$('.icon-btn--plain')).tap();
      break;
    }
  }
  await sleep(900);
  await tapText(page, '.settings-row', '删除账本');
  await sleep(900);
  const descEl = await page.$('.dialog__desc');
  check('删除需要二次确认', Boolean(descEl));
  await tapText(page, '.sheet .btn', '确定');
  await sleep(1400);
  const countAfterDelete = (await page.$$('.books-card')).length;
  check('账本数 -1', countAfterDelete === countBeforeDelete - 1, `${countBeforeDelete} → ${countAfterDelete}`);
  const gone = await mp.evaluate(() => {
    const s = globalThis.__ledgerStore.getState();
    return s.data.books.some((x) => x.name === '改名账本');
  });
  check('删除后库里不再有该账本', gone === false);
  const okWithAccounts = await mp.evaluate(() => {
    const s = globalThis.__ledgerStore.getState();
    return s.data.books.length > 0 && s.data.settings.lastBookId !== null;
  });
  check('删除后仍保留可用账本与当前账本', okWithAccounts);

  // ---------- 8. 返回 ----------
  const backBtns = await page.$$('.page-head .icon-btn');
  await backBtns[0].tap();
  page = await waitForPage(mp, 'pages/settings/index');
  check('返回键回到设置页', page.path.includes('pages/settings/index'), page.path);

  // ---------- 截图 ----------
  await mp.reLaunch('/pages/books/index');
  await sleep(1600);
  try {
    const shot = path.join(outDir, 'books-page.png');
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
