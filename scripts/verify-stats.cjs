/**
 * 统计图表页验收。
 *
 * 前提：cli.bat auto --project . --auto-port 9420 已运行，且已执行过 taro build。
 *
 * 说明：先重置为「4 个不同分类的支出」再断言，这样环形图一定有 4 段、
 * 排行一定有 4 行，不依赖模拟器里残留的历史数据。
 *
 * 验收点：
 * 1. 底栏点「图表」能进统计页，标题与副标题正确
 * 2. 分类/账户/项目/商家四个维度能切换且重算
 * 3. 支出/收入分段、日/周/月/年区间、前后翻页都能改变 label
 * 4. 环形图 canvas 渲染出来，中心金额等于该区间支出合计
 * 5. 排行列表行数与分组数一致，点击行能高亮
 * 6. 饼图/条形图切换生效
 * 7. 近 6 个月趋势有 6 根柱子
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
    if (t === text) {
      await el.tap();
      return true;
    }
  }
  return false;
}

const count = async (page, selector) => (await page.$$(selector)).length;

(async () => {
  const mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${PORT}` });
  console.log('已连接自动化端口\n');

  // ---------- 0. 播种 4 个分类的支出 ----------
  // 第一组刻意给 25 笔：只有条数超过 10 才能验到「默认 10 条 / 每次展开更多 +10」。
  // 金额仍保持第一组最大，这样「默认选中第一组」是稳定的。
  const seed = await mp.evaluate(() => {
    const s = globalThis.__ledgerStore.getState();
    const book = s.data.books[0];
    for (const tx of s.data.txs.filter((t) => t.bookId === book.id)) s.deleteTx(tx.id);

    const now = globalThis.__ledgerStore.getState();
    const acc = now.data.accounts.filter((a) => a.bookId === book.id && !a.archived)[0];
    // 取 4 个不同的「根分类」，保证环形图分成 4 段
    const roots = now.data.categories.filter(
      (c) => c.type === 'expense' && !c.archived && !c.parentId,
    );
    const picked = roots.slice(0, 4);
    const pad = (n) => String(n).padStart(2, '0');
    const today = new Date();
    const stamp = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    const counts = [25, 1, 1, 1];
    const unit = [200, 3000, 2000, 1000];

    picked.forEach((cat, index) => {
      for (let i = 0; i < counts[index]; i += 1) {
        globalThis.__ledgerStore.getState().addTx({
          bookId: book.id,
          type: 'expense',
          amount: unit[index],
          categoryId: cat.id,
          accountId: acc ? acc.id : null,
          toAccountId: null,
          projectId: null,
          merchant: '',
          note: index === 0 ? `明细${i + 1}` : `样本${index + 1}`,
          occurredAt: `${stamp}T09:${pad(index === 0 ? i : index)}`,
        });
      }
    });

    return {
      bookName: book.name,
      categories: picked.map((c) => c.name),
      totalFen: picked.reduce((sum, _, i) => sum + counts[i] * unit[i], 0),
      firstCount: counts[0],
    };
  });
  console.log(
    `已播种 ${seed.categories.length} 个分类（${seed.categories.join('、')}），第一组 ${seed.firstCount} 笔，合计 ${seed.totalFen} 分\n`,
  );
  check('播种 4 个分类的支出', seed.categories.length === 4, String(seed.categories.length));
  check('第一组有 25 笔', seed.firstCount === 25, String(seed.firstCount));

  // ---------- 1. 从底栏进统计页 ----------
  await mp.reLaunch('/pages/home/index');
  await sleep(1500);
  let page = await mp.currentPage();
  const entered = await tapText(page, '.tabbar__item', '图表');
  check('底栏有「图表」入口', entered);
  page = await waitForPage(mp, 'pages/stats/index');
  check('进入统计页', page.path.includes('pages/stats/index'), page.path);

  const titleEl = await page.$('.stats-head__title');
  const subEl = await page.$('.stats-head__sub');
  const title = titleEl ? (await titleEl.text()).trim() : '';
  const sub = subEl ? (await subEl.text()).trim() : '';
  check('标题为「统计图表」', title === '统计图表', title);
  check('副标题含账本名', sub.includes(seed.bookName), sub);

  // ---------- 2. 环形图 ----------
  const canvas = await page.$('.donut-canvas');
  check('环形图 canvas 渲染出来', Boolean(canvas));
  const centerValue = await page.$('.donut-center__value');
  const shownTotal = centerValue ? (await centerValue.text()).replace(/\s/g, '') : '';
  const expectTotal = `${seed.totalFen / 100 >= 1000 ? '' : ''}${(seed.totalFen / 100).toFixed(2)}`;
  check(
    '环形图中心金额等于支出合计',
    shownTotal.replace('¥', '') === expectTotal,
    `页面 ${shownTotal} / 期望 ${expectTotal}`,
  );

  let rankRows = await count(page, '.rank-row');
  check('排行有 4 行', rankRows === 4, `${rankRows} 行`);
  // 明细面板绝不能也用 .rank-row，否则上面这条会数错；再拿分组容器数量兜一层
  const rankGroups = await count(page, '.rank-group');
  check('排行分组也是 4 个', rankGroups === 4, `${rankGroups} 个`);

  // ---------- 3. 明细面板：默认展开第一组前 10 条 ----------
  const scrollTo = async (top) => {
    await mp.evaluate((value) => {
      try {
        wx.pageScrollTo({ scrollTop: value, duration: 0 });
      } catch (error) {
        /* 滚动失败不影响结论 */
      }
    }, top);
    await sleep(420);
  };

  /**
   * 点第 index 个排行行。
   * 默认展开 10 条明细后，第二行会被推到视口外，而 automator 的 tap() 不会自动滚动，
   * 直接点会落空 —— 所以先回到顶部，再按需滚到目标行。
   */
  const tapRankRow = async (index) => {
    await scrollTo(0);
    const list = await page.$$('.rank-row');
    const el = list[index];
    if (!el) return false;
    const box = await el.offset();
    if (box.top > 460) await scrollTo(Math.max(0, box.top - 200));
    await el.tap();
    await sleep(600);
    return true;
  };

  let detailPanels = await count(page, '.rank-detail');
  check('默认展开一个明细面板', detailPanels === 1, `${detailPanels} 个`);

  let detailRows = await count(page, '.rank-detail .tx-row');
  check('默认展开前 10 条', detailRows === 10, `${detailRows} 条`);

  const moreBtn = await page.$('.rank-detail__more');
  check('有「展开更多」按钮', Boolean(moreBtn));

  if (moreBtn) {
    await moreBtn.tap();
    await sleep(500);
    detailRows = await count(page, '.rank-detail .tx-row');
    check('展开更多后 20 条', detailRows === 20, `${detailRows} 条`);

    const moreBtn2 = await page.$('.rank-detail__more');
    if (moreBtn2) {
      await moreBtn2.tap();
      await sleep(500);
      detailRows = await count(page, '.rank-detail .tx-row');
      check('再点一次共 25 条', detailRows === 25, `${detailRows} 条`);
    }
    check('加载完毕后不再有「展开更多」', !(await page.$('.rank-detail__more')));

    const endEl = await page.$('.rank-detail__end');
    const endText = endEl ? (await endEl.text()).trim() : '';
    check('终态文案为已显示全部', endText === `已显示全部 ${seed.firstCount} 笔`, endText);
  }

  // ---------- 4. 切换分组 / 折叠 ----------
  const tappedSecond = await tapRankRow(1);
  check('点击排行第二行', tappedSecond);
  const openRows = await page.$$('.rank-row--open');
  check('点击排行行后展开态切换过去', openRows.length === 1, `${openRows.length} 个展开态`);
  const captionName = await page.$('.donut-caption__name');
  const captionText = captionName ? (await captionName.text()).trim() : '';
  check('环形图下方说明跟随切换', captionText.length > 0, captionText);

  detailPanels = await count(page, '.rank-detail');
  check('明细面板跟着换到第二组', detailPanels === 1, `${detailPanels} 个`);
  detailRows = await count(page, '.rank-detail .tx-row');
  check('第二组只有 1 笔明细', detailRows === 1, `${detailRows} 条`);

  await tapRankRow(0);
  detailRows = await count(page, '.rank-detail .tx-row');
  check('切回第一组时明细重新从 10 条开始', detailRows === 10, `${detailRows} 条`);

  await tapRankRow(0);
  detailPanels = await count(page, '.rank-detail');
  const openAfterCollapse = await count(page, '.rank-row--open');
  const captionAfterCollapse = await page.$('.donut-caption__name');
  check('再点同一行可折叠明细', detailPanels === 0, `${detailPanels} 个`);
  // 折叠后排行行不能再留底色 —— 原来这里断言「仍保持唯一高亮 === 1」，
  // 那是把缺陷当成了正确行为：一行孤零零的灰底夹在白卡里，读起来像「禁用」。
  check('折叠后排行行不再有展开态底色', openAfterCollapse === 0, `${openAfterCollapse} 个`);
  // 但圆环要保留选中：收起明细 ≠ 不再看这个分类
  check('折叠后圆环仍标着该分类', Boolean(captionAfterCollapse), captionAfterCollapse ? '说明保留' : '说明丢了');

  // 展开回来，让后续维度切换的页面状态与「默认」一致
  await tapRankRow(0);
  await sleep(500);
  const openAfterExpand = await count(page, '.rank-row--open');
  check('再点回来后展开态恢复为 1', openAfterExpand === 1, `${openAfterExpand} 个`);
  await scrollTo(0);

  // ---------- 4. 维度切换 ----------
  for (const dim of ['账户', '项目', '商家', '分类']) {
    const ok = await tapText(page, '.chip', dim);
    await sleep(700);
    const rowsNow = await count(page, '.rank-row');
    check(`维度切到「${dim}」`, ok, `排行 ${rowsNow} 行`);
  }

  // ---------- 5. 支出/收入分段 ----------
  const tappedIncome = await tapText(page, '.segmented__item', '收入');
  await sleep(800);
  const incomeEmpty = await page.$('.stats-empty-card');
  check('切到收入（无数据）显示空状态', tappedIncome && Boolean(incomeEmpty));
  await tapText(page, '.segmented__item', '支出');
  await sleep(800);
  rankRows = await count(page, '.rank-row');
  check('切回支出恢复排行', rankRows === 4, `${rankRows} 行`);

  // ---------- 6. 区间切换 ----------
  const labelEl = await page.$('.stats-range__label');
  const labelMonth = labelEl ? (await labelEl.text()).trim() : '';
  const tappedYear = await tapText(page, '.chip--sm', '年');
  await sleep(800);
  const yearLabelEl = await page.$('.stats-range__label');
  const labelYear = yearLabelEl ? (await yearLabelEl.text()).trim() : '';
  check('切到「年」区间 label 变化', tappedYear && labelYear !== labelMonth, `${labelMonth} → ${labelYear}`);
  check('年度 label 含「年」', labelYear.includes('年'), labelYear);

  await tapText(page, '.chip--sm', '月');
  await sleep(800);
  const backLabelEl = await page.$('.stats-range__label');
  const backLabel = backLabelEl ? (await backLabelEl.text()).trim() : '';
  check('切回「月」区间', backLabel === labelMonth, backLabel);

  // ---------- 7. 前后翻页 ----------
  const arrows = await page.$$('.stats-range__arrow');
  check('区间有左右两个箭头', arrows.length === 2, `${arrows.length} 个`);
  if (arrows.length === 2) {
    await arrows[0].tap();
    await sleep(800);
    const prevLabelEl = await page.$('.stats-range__label');
    const prevLabel = prevLabelEl ? (await prevLabelEl.text()).trim() : '';
    check('点上一个周期 label 变化', prevLabel !== labelMonth, `${labelMonth} → ${prevLabel}`);
    await arrows[1].tap();
    await sleep(800);
    const nextLabelEl = await page.$('.stats-range__label');
    const nextLabel = nextLabelEl ? (await nextLabelEl.text()).trim() : '';
    check('点下一个周期回到本月', nextLabel === labelMonth, nextLabel);
  }

  // ---------- 8. 饼图/条形图切换 ----------
  const toggle = await page.$('.stats-head .icon-btn');
  check('顶部有视图切换按钮', Boolean(toggle));
  if (toggle) {
    await toggle.tap();
    await sleep(900);
    const bars = await count(page, '.bar-item');
    const donut = await page.$('.donut-canvas');
    check('切到条形图', bars === 4 && !donut, `bar ${bars} 个，donut ${donut ? '仍在' : '已隐藏'}`);

    await toggle.tap();
    await sleep(900);
    const donutBack = await page.$('.donut-canvas');
    check('切回环形图', Boolean(donutBack));
  }

  // ---------- 9. 近 6 个月趋势 ----------
  const barsCount = await count(page, '.month-bar');
  check('趋势图有 6 根柱子', barsCount === 6, `${barsCount} 根`);

  // ---------- 截图 ----------
  try {
    const shot = path.join(outDir, 'stats-page.png');
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
