/**
 * 分类管理页验收。
 *
 * 前提：cli.bat auto --project . --auto-port 9420 已运行，且已执行过 taro build。
 *
 * 路径：首页 → 底栏「我的」→「分类管理」，走真实入口。
 *
 * 验收点：
 * 1. 从设置页进入，标题正确，支出分类默认选中，预设分类存在
 * 2. 展开一级分类能看到子分类 chips
 * 3. 新增一级分类：选图标、选颜色、保存 → 列表 +1，落库含图标/颜色
 * 4. 新增子分类：继承父级图标颜色，parentId 正确
 * 5. 编辑分类改名生效
 * 6. 删除子分类：二次确认 → 变少且为软删除
 * 7. 删除一级分类：连带停用子分类
 * 8. 切到收入分类：能看到改过名的预设项「补贴收入」（敏感词清理后的名字）
 * 9. 返回键回到设置页
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

const texts = async (page, selector) => {
  const els = await page.$$(selector);
  const out = [];
  for (const el of els) out.push((await el.text()).replace(/\s+/g, ' ').trim());
  return out;
};

(async () => {
  const mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${PORT}` });
  console.log('已连接自动化端口\n');

  // ---------- 0. 清理上次残留（含其子分类） ----------
  const cleaned = await mp.evaluate(() => {
    const s = globalThis.__ledgerStore.getState();
    const junk = s.data.categories.filter((c) =>
      ['测试分类', '测试子分类', '改名分类'].includes(c.name),
    );
    if (!junk.length) return 0;
    const ids = junk.map((c) => c.id);
    globalThis.__ledgerStore.getState().importData({
      ...s.data,
      categories: s.data.categories.filter((c) => !ids.includes(c.id) && !ids.includes(c.parentId)),
    });
    return junk.length;
  });
  console.log(cleaned ? `清理了 ${cleaned} 个上次残留的测试分类\n` : '无残留测试分类\n');

  // ---------- 1. 我的 → 分类管理 ----------
  await mp.reLaunch('/pages/home/index');
  await sleep(1500);
  let page = await mp.currentPage();
  await tapText(page, '.tabbar__item', '我的');
  page = await waitForPage(mp, 'pages/settings/index');

  const entered = await tapText(page, '.settings-row', '分类管理');
  page = await waitForPage(mp, 'pages/categories/index');
  check('从「我的」进入分类管理页', entered && page.path.includes('pages/categories/index'), page.path);

  const titleEl = await page.$('.page-head__title');
  const title = titleEl ? (await titleEl.text()).trim() : '';
  check('标题为「分类管理」', title === '分类管理', title);

  const segActive = await page.$('.segmented__item--active');
  const segText = segActive ? (await segActive.text()).trim() : '';
  check('默认选中「支出分类」', segText === '支出分类', segText);

  const rootCountBefore = (await page.$$('.cat-root')).length;
  const rootNames = await texts(page, '.cat-root__row');
  check('一级分类列表非空', rootCountBefore > 0, `${rootCountBefore} 个：${rootNames.join('、')}`);
  check(
    '预设分类含「餐饮」',
    rootNames.some((n) => n.includes('餐饮')),
    rootNames.join('、'),
  );

  // ---------- 2. 展开一级分类 ----------
  const foodTapped = await tapText(page, '.cat-root__row', '餐饮');
  await sleep(600);
  const childChips = await texts(page, '.cat-chips .chip');
  check('点击行展开子分类', foodTapped && childChips.length > 0, `${childChips.length} 个子分类`);
  const addChildBtn = await page.$('.cat-add-child');
  check('展开面板有「添加子分类」', Boolean(addChildBtn));

  // 收起，避免影响后面的行定位
  await tapText(page, '.cat-root__row', '餐饮');
  await sleep(400);

  // ---------- 3. 新增一级分类 ----------
  const headBtns = await page.$$('.page-head .icon-btn');
  check('顶部有返回与加号', headBtns.length >= 2, `${headBtns.length} 个按钮`);
  await headBtns[headBtns.length - 1].tap();
  await sleep(900);
  const sheet = await page.$('.sheet');
  check('新增弹层打开', Boolean(sheet));
  const sheetTitle = await page.$('.sheet__title');
  const st = sheetTitle ? (await sheetTitle.text()).trim() : '';
  check('弹层标题为「新增一级分类」', st === '新增一级分类', st);

  const nameInput = await page.$('.cat-form .input');
  await nameInput.input('测试分类');
  await sleep(300);

  const iconBtns = await page.$$('.cat-icon');
  check('图标选择器有选项', iconBtns.length >= 10, `${iconBtns.length} 个`);
  await iconBtns[3].tap();
  await sleep(200);
  const colorBtns = await page.$$('.cat-color');
  check('颜色选择器有选项', colorBtns.length >= 6, `${colorBtns.length} 个`);
  await colorBtns[2].tap();
  await sleep(200);

  await (await page.$('.cat-submit')).tap();
  await sleep(1200);
  check('保存后弹层关闭', !(await page.$('.sheet')));

  const rootCountAfter = (await page.$$('.cat-root')).length;
  check('一级分类 +1', rootCountAfter === rootCountBefore + 1, `${rootCountBefore} → ${rootCountAfter}`);

  const created = await mp.evaluate(() => {
    const s = globalThis.__ledgerStore.getState();
    const c = s.data.categories.find((x) => x.name === '测试分类');
    return c ? { icon: c.icon, color: c.color, type: c.type, parentId: c.parentId, archived: c.archived } : null;
  });
  check('新分类已落库', Boolean(created), JSON.stringify(created));
  check('图标为第 4 个选项 home', created && created.icon === 'home', created ? created.icon : '');
  check('颜色为第 3 个选项', created && created.color === '#e8608c', created ? created.color : '');
  check('新分类为支出、一级、未归档', Boolean(created && created.type === 'expense' && created.parentId === null && !created.archived));

  // ---------- 4. 新增子分类 ----------
  await tapText(page, '.cat-root__row', '测试分类');
  await sleep(600);
  const addChild = await page.$('.cat-add-child');
  await addChild.tap();
  await sleep(900);
  const childTitleEl = await page.$('.sheet__title');
  const childTitle = childTitleEl ? (await childTitleEl.text()).trim() : '';
  check('弹层标题为「新增子分类」', childTitle === '新增子分类', childTitle);
  const childIconSection = await page.$('.cat-icons');
  check('子分类不显示图标选择（继承父级）', !childIconSection);

  await (await page.$('.cat-form .input')).input('测试子分类');
  await sleep(300);
  await (await page.$('.cat-submit')).tap();
  await sleep(1200);

  const childChips2 = await texts(page, '.cat-chips .chip');
  check('子分类出现在展开面板', childChips2.some((n) => n.includes('测试子分类')), childChips2.join('、'));

  const childData = await mp.evaluate(() => {
    const s = globalThis.__ledgerStore.getState();
    const child = s.data.categories.find((x) => x.name === '测试子分类');
    const parent = child ? s.data.categories.find((x) => x.id === child.parentId) : null;
    return child ? { parentId: child.parentId, parentName: parent ? parent.name : '', icon: child.icon, color: child.color } : null;
  });
  check('子分类挂在一级分类下', Boolean(childData && childData.parentName === '测试分类'), JSON.stringify(childData));
  check(
    '子分类继承父级图标与颜色',
    Boolean(childData && childData.icon === 'home' && childData.color === '#e8608c'),
    childData ? `${childData.icon} / ${childData.color}` : '',
  );

  // ---------- 5. 编辑改名 ----------
  const roots = await page.$$('.cat-root');
  let target = null;
  for (const root of roots) {
    const t = (await root.text()).replace(/\s+/g, '');
    if (t.includes('测试分类')) {
      target = root;
      break;
    }
  }
  check('能在列表定位到新建的分类', Boolean(target));
  if (target) {
    const btns = await target.$$('.icon-btn--plain');
    check('行内有编辑与删除两个按钮', btns.length === 2, `${btns.length} 个`);
    await btns[0].tap();
    await sleep(900);
    const editTitleEl = await page.$('.sheet__title');
    const et = editTitleEl ? (await editTitleEl.text()).trim() : '';
    check('弹层标题为「编辑分类」', et === '编辑分类', et);

    const editInput = await page.$('.cat-form .input');
    await editInput.input('改名分类');
    await sleep(300);
    await (await page.$('.cat-submit')).tap();
    await sleep(1200);
    const afterRename = await texts(page, '.cat-root__row');
    check('改名生效', afterRename.some((n) => n.includes('改名分类')), afterRename.join('、'));
  }

  // ---------- 6. 删除子分类（软删除） ----------
  // 上一步改完名后面板仍是展开状态，这里不能再点一次行（点一下就收起了），
  // 先看面板在不在，不在才去展开。
  let chips = await page.$$('.cat-chips .chip');
  if (!chips.length) {
    await tapText(page, '.cat-root__row', '改名分类');
    await sleep(600);
    chips = await page.$$('.cat-chips .chip');
  }
  let xBtn = null;
  for (const chip of chips) {
    const t = (await chip.text()).replace(/\s+/g, '');
    if (t.includes('测试子分类')) {
      xBtn = await chip.$('.cat-chip__x');
      break;
    }
  }
  check('子分类带删除叉号', Boolean(xBtn));
  if (xBtn) {
    await xBtn.tap();
    await sleep(900);
    const confirmDesc = await page.$('.dialog__desc');
    check('删除子分类需要二次确认', Boolean(confirmDesc));
    await tapText(page, '.sheet .btn', '确定');
    await sleep(1200);
    const leftChips = await texts(page, '.cat-chips .chip');
    check(
      '子分类从面板消失',
      !leftChips.some((n) => n.includes('测试子分类')),
      leftChips.join('、'),
    );
    const soft = await mp.evaluate(() => {
      const s = globalThis.__ledgerStore.getState();
      const c = s.data.categories.find((x) => x.name === '测试子分类');
      return c ? c.archived : null;
    });
    check('子分类为软删除（记录保留并停用）', soft === true, String(soft));
  }

  // ---------- 7. 删除一级分类 ----------
  const roots2 = await page.$$('.cat-root');
  const countBeforeDelete = roots2.length;
  for (const root of roots2) {
    const t = (await root.text()).replace(/\s+/g, '');
    if (t.includes('改名分类')) {
      const btns = await root.$$('.icon-btn--plain');
      await btns[1].tap();
      break;
    }
  }
  await sleep(900);
  const descRoot = await page.$('.dialog__desc');
  const descText = descRoot ? (await descRoot.text()).replace(/\s+/g, '') : '';
  check('删除一级分类会提示连带停用子分类', descText.includes('子分类'), descText);
  await tapText(page, '.sheet .btn', '确定');
  await sleep(1200);
  const countAfterDelete = (await page.$$('.cat-root')).length;
  check('一级分类 -1', countAfterDelete === countBeforeDelete - 1, `${countBeforeDelete} → ${countAfterDelete}`);

  // ---------- 8. 收入分类 ----------
  await tapText(page, '.segmented__item', '收入分类');
  await sleep(800);
  const incomeNames = await texts(page, '.cat-root__row');
  check('收入分类非空', incomeNames.length > 0, incomeNames.join('、'));
  check(
    '收入分类含「补贴收入」（原敏感分类改名后）',
    incomeNames.some((n) => n.includes('补贴收入')),
    incomeNames.join('、'),
  );
  const stillExpense = await mp.evaluate(() => {
    const s = globalThis.__ledgerStore.getState();
    const c = s.data.categories.find((x) => x.name === '改名分类');
    return c ? c.archived : null;
  });
  check('被删的一级分类已停用', stillExpense === true, String(stillExpense));

  // ---------- 9. 返回 ----------
  const backBtns = await page.$$('.page-head .icon-btn');
  await backBtns[0].tap();
  page = await waitForPage(mp, 'pages/settings/index');
  check('返回键回到设置页', page.path.includes('pages/settings/index'), page.path);

  // ---------- 截图 ----------
  await mp.reLaunch('/pages/categories/index');
  await sleep(1600);
  try {
    const shot = path.join(outDir, 'categories-page.png');
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
