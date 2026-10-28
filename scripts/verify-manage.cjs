/**
 * 项目 + 记账模板 两页合并验收。
 *
 * 前提：cli.bat auto --project . --auto-port 9420 已运行，且已执行过 taro build。
 *
 * 两页都是轻量 CRUD（列表 + 弹层表单 + 删除确认），流程短，
 * 合并成一个脚本跑一次即可，不必为 6 个断言各起一次小程序。
 *
 * 项目验收点：
 * 1. 我的 → 项目，标题与副标题正确
 * 2. 新建项目 → 列表 +1、落库到当前账本
 * 3. 点行打开「项目设置」，改名生效
 * 4. 删除（软删除）→ 列表 -1、archived=true
 *
 * 模板验收点：
 * 5. 我的 → 记账模板，标题正确
 * 6. 新建模板：填名称/金额、选分类（走 CategoryPicker 二级弹层）→ 落库 1250 分
 * 7. 列表显示「支出 · 分类」摘要
 * 8. 编辑改名生效
 * 9. 删除（硬删除）→ 列表 -1、库里不再有
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

const rowTitles = async (page) => {
  const els = await page.$$('.row__title');
  const out = [];
  for (const el of els) out.push((await el.text()).replace(/\s+/g, ' ').trim());
  return out;
};

async function gotoFromSettings(mp, rowLabel, pagePath) {
  await mp.reLaunch('/pages/home/index');
  await sleep(1500);
  let page = await mp.currentPage();
  await tapText(page, '.tabbar__item', '我的');
  page = await waitForPage(mp, 'pages/settings/index');
  const entered = await tapText(page, '.settings-row', rowLabel);
  page = await waitForPage(mp, pagePath);
  return { page, entered };
}

(async () => {
  const mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${PORT}` });
  console.log('已连接自动化端口\n');

  const bookName = await mp.evaluate(() => {
    const s = globalThis.__ledgerStore.getState();
    return s.data.books.find((b) => b.id === s.data.settings.lastBookId)?.name ?? s.data.books[0].name;
  });

  // ---------- 0. 清理残留 ----------
  const cleaned = await mp.evaluate(() => {
    const s = globalThis.__ledgerStore.getState();
    const pj = s.data.projects.filter((p) => ['测试项目', '改名项目'].includes(p.name));
    const tp = s.data.templates.filter((t) => ['测试模板', '改名模板'].includes(t.name));
    if (!pj.length && !tp.length) return 0;
    const pjIds = pj.map((p) => p.id);
    const tplIds = tp.map((t) => t.id);
    globalThis.__ledgerStore.getState().importData({
      ...s.data,
      projects: s.data.projects.filter((p) => !pjIds.includes(p.id)),
      templates: s.data.templates.filter((t) => !tplIds.includes(t.id)),
      txs: s.data.txs.map((tx) => (pjIds.includes(tx.projectId) ? { ...tx, projectId: null } : tx)),
    });
    return pj.length + tp.length;
  });
  console.log(cleaned ? `清理了 ${cleaned} 条上次残留\n` : '无残留测试数据\n');

  // ================= 项目 =================
  const prjNav = await gotoFromSettings(mp, '项目', 'pages/projects/index');
  let page = prjNav.page;
  check('从「我的」进入项目页', prjNav.entered && page.path.includes('pages/projects/index'), page.path);

  const prjTitleEl = await page.$('.page-head__title');
  const prjTitle = prjTitleEl ? (await prjTitleEl.text()).trim() : '';
  check('标题为「项目」', prjTitle === '项目', prjTitle);
  const prjSubEl = await page.$('.page-head__sub');
  const prjSub = prjSubEl ? (await prjSubEl.text()).trim() : '';
  check('副标题为账本名', prjSub === bookName, `页面 ${prjSub} / 期望 ${bookName}`);

  const prjBefore = (await page.$$('.row')).length;
  const prjHeadBtns = await page.$$('.page-head .icon-btn');
  await prjHeadBtns[prjHeadBtns.length - 1].tap();
  await sleep(900);
  const prjSheetTitle = await page.$('.sheet__title');
  const pst = prjSheetTitle ? (await prjSheetTitle.text()).trim() : '';
  check('新建项目弹层标题正确', pst === '新建项目', pst);
  await (await page.$('.prj-form .input')).input('测试项目');
  await sleep(300);
  const prjColors = await page.$$('.prj-color');
  check('颜色选择器有选项', prjColors.length >= 5, `${prjColors.length} 个`);
  await prjColors[2].tap();
  await sleep(200);
  await (await page.$('.prj-submit')).tap();
  await sleep(1300);

  const prjAfter = (await page.$$('.row')).length;
  check('项目数 +1', prjAfter === prjBefore + 1, `${prjBefore} → ${prjAfter}`);
  const prjData = await mp.evaluate(() => {
    const s = globalThis.__ledgerStore.getState();
    const p = s.data.projects.find((x) => x.name === '测试项目');
    return p ? { id: p.id, color: p.color, bookId: p.bookId, archived: p.archived } : null;
  });
  check('项目已落库', Boolean(prjData), JSON.stringify(prjData));
  check('颜色取第 3 个选项', prjData && prjData.color === '#7b8ff7', prjData ? prjData.color : '');

  // 点行改名
  await tapText(page, '.row__title', '测试项目');
  await sleep(900);
  const prjEditTitleEl = await page.$('.sheet__title');
  const pet = prjEditTitleEl ? (await prjEditTitleEl.text()).trim() : '';
  check('弹层标题为「项目设置」', pet === '项目设置', pet);
  await (await page.$('.prj-form .input')).input('改名项目');
  await sleep(300);
  await (await page.$('.prj-submit')).tap();
  await sleep(1300);
  const prjRenamed = await rowTitles(page);
  check('项目改名生效', prjRenamed.some((n) => n.includes('改名项目')), prjRenamed.join('、'));

  // 删除项目
  await tapText(page, '.row__title', '改名项目');
  await sleep(900);
  const delBtn = await page.$('.prj-delete');
  check('编辑弹层里有删除项目按钮', Boolean(delBtn));
  await delBtn.tap();
  await sleep(900);
  check('删除需要二次确认', Boolean(await page.$('.dialog__desc')));
  await tapText(page, '.sheet .btn', '确定');
  await sleep(1400);
  const prjFinal = (await page.$$('.row')).length;
  check('项目数 -1', prjFinal === prjAfter - 1, `${prjAfter} → ${prjFinal}`);
  const prjArchived = await mp.evaluate(() => {
    const s = globalThis.__ledgerStore.getState();
    const p = s.data.projects.find((x) => x.name === '改名项目');
    return p ? p.archived : null;
  });
  check('删除为软删除（archived=true）', prjArchived === true, String(prjArchived));

  await (await page.$$('.page-head .icon-btn'))[0].tap();
  page = await waitForPage(mp, 'pages/settings/index');
  check('项目页返回设置页', page.path.includes('pages/settings/index'), page.path);

  // ================= 模板 =================
  const tplNav = await gotoFromSettings(mp, '记账模板', 'pages/templates/index');
  page = tplNav.page;
  check('从「我的」进入模板页', tplNav.entered && page.path.includes('pages/templates/index'), page.path);

  const tplTitleEl = await page.$('.page-head__title');
  const tplTitle = tplTitleEl ? (await tplTitleEl.text()).trim() : '';
  check('标题为「模板」', tplTitle === '模板', tplTitle);

  const tplBefore = (await page.$$('.row')).length;
  const tplHeadBtns = await page.$$('.page-head .icon-btn');
  await tplHeadBtns[tplHeadBtns.length - 1].tap();
  await sleep(900);
  const tplSheetTitle = await page.$('.sheet__title');
  const tst = tplSheetTitle ? (await tplSheetTitle.text()).trim() : '';
  check('新建模板弹层标题正确', tst === '新建模板', tst);

  const tplInputs = await page.$$('.tpl-form .input');
  check('表单含名称/金额/备注三个输入框', tplInputs.length === 3, `${tplInputs.length} 个`);
  await tplInputs[0].input('测试模板');
  await sleep(200);
  await tplInputs[1].input('12.5');
  await sleep(200);

  // 选分类：chip → CategoryPicker 二级弹层 → 根分类 → 子分类
  await tapText(page, '.tpl-chip', '选择分类');
  await sleep(900);
  const pickerSheet = await page.$('.cat-grid');
  check('打开分类选择弹层', Boolean(pickerSheet));
  const rootTapped = await tapText(page, '.cat-item', '餐饮');
  await sleep(500);
  const subTapped = await tapText(page, '.cat-sub', '早午晚餐');
  await sleep(900);
  check('选中子分类', rootTapped && subTapped);
  const chipText = await page.$$('.tpl-chip');
  const chips = [];
  for (const c of chipText) chips.push((await c.text()).replace(/\s+/g, ''));
  check('分类 chip 回填分类名', chips.some((t) => t.includes('早午晚餐')), chips.join(' | '));

  await (await page.$('.tpl-submit')).tap();
  await sleep(1400);
  const tplAfter = (await page.$$('.row')).length;
  check('模板数 +1', tplAfter === tplBefore + 1, `${tplBefore} → ${tplAfter}`);

  const tplData = await mp.evaluate(() => {
    const s = globalThis.__ledgerStore.getState();
    const t = s.data.templates.find((x) => x.name === '测试模板');
    return t
      ? { amount: t.amount, type: t.type, categoryId: t.categoryId, accountId: t.accountId, note: t.note }
      : null;
  });
  check('模板已落库', Boolean(tplData), JSON.stringify(tplData));
  check('金额存为 1250 分', tplData && tplData.amount === 1250, tplData ? String(tplData.amount) : '');
  check('分类为「早午晚餐」', tplData && tplData.categoryId === 'cat_food_1', tplData ? String(tplData.categoryId) : '');
  check('账户已默认选中', Boolean(tplData && tplData.accountId));

  const rowText = await page.$$('.row');
  const rowTexts = [];
  for (const r of rowText) rowTexts.push((await r.text()).replace(/\s+/g, ''));
  check(
    '行摘要含「支出 · 分类」',
    rowTexts.some((t) => t.includes('测试模板') && t.includes('支出') && t.includes('早午晚餐')),
    rowTexts.join(' | '),
  );

  // 编辑改名
  await tapText(page, '.row__title', '测试模板');
  await sleep(900);
  const tplEditTitleEl = await page.$('.sheet__title');
  const tet = tplEditTitleEl ? (await tplEditTitleEl.text()).trim() : '';
  check('弹层标题为「编辑模板」', tet === '编辑模板', tet);
  await (await page.$$('.tpl-form .input'))[0].input('改名模板');
  await sleep(300);
  await (await page.$('.tpl-submit')).tap();
  await sleep(1400);
  const tplRenamed = await rowTitles(page);
  check('模板改名生效', tplRenamed.some((n) => n.includes('改名模板')), tplRenamed.join('、'));

  // 删除模板
  await tapText(page, '.row__title', '改名模板');
  await sleep(900);
  const tplDel = await page.$('.tpl-delete');
  check('编辑弹层里有删除模板按钮', Boolean(tplDel));
  await tplDel.tap();
  await sleep(900);
  check('删除模板需要二次确认', Boolean(await page.$('.dialog__desc')));
  await tapText(page, '.sheet .btn', '确定');
  await sleep(1400);
  const tplFinal = (await page.$$('.row')).length;
  check('模板数 -1', tplFinal === tplAfter - 1, `${tplAfter} → ${tplFinal}`);
  const tplGone = await mp.evaluate(() => {
    const s = globalThis.__ledgerStore.getState();
    return !s.data.templates.some((x) => x.name === '改名模板');
  });
  check('模板为硬删除（库里不再有）', tplGone);

  await (await page.$$('.page-head .icon-btn'))[0].tap();
  page = await waitForPage(mp, 'pages/settings/index');
  check('模板页返回设置页', page.path.includes('pages/settings/index'), page.path);

  // ---------- 截图 ----------
  await mp.evaluate(() => {
    const s = globalThis.__ledgerStore.getState();
    const bookId = s.data.settings.lastBookId ?? s.data.books[0].id;
    const now = new Date().toISOString().slice(0, 19);
    globalThis.__ledgerStore.getState().importData({
      ...s.data,
      projects: [
        ...s.data.projects,
        { id: 'prj_shot_1', bookId, name: '装修', color: '#7b8ff7', archived: false },
        { id: 'prj_shot_2', bookId, name: '旅行', color: '#4bb3a0', archived: false },
      ],
      templates: [
        ...s.data.templates,
        {
          id: 'tpl_shot_1',
          bookId,
          name: '早餐',
          type: 'expense',
          amount: 1200,
          categoryId: 'cat_food_2',
          accountId: null,
          projectId: null,
          merchant: '',
          note: '食堂',
          sort: 90,
          updatedAt: now,
        },
      ],
    });
  });
  await mp.reLaunch('/pages/projects/index');
  await sleep(1500);
  try {
    await mp.screenshot({ path: path.join(outDir, 'projects-page.png') });
    await mp.reLaunch('/pages/templates/index');
    await sleep(1500);
    await mp.screenshot({ path: path.join(outDir, 'templates-page.png') });
    console.log(`\n截图: projects-page.png / templates-page.png`);
  } catch (e) {
    console.log('截图失败（不影响结论）:', e.message);
  }

  // 撤掉展示用数据
  await mp.evaluate(() => {
    const s = globalThis.__ledgerStore.getState();
    globalThis.__ledgerStore.getState().importData({
      ...s.data,
      projects: s.data.projects.filter((p) => !p.id.startsWith('prj_shot_')),
      templates: s.data.templates.filter((t) => !t.id.startsWith('tpl_shot_')),
    });
  });

  await mp.disconnect();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n合计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error('失败:', err && err.message ? err.message : err);
  process.exit(1);
});
