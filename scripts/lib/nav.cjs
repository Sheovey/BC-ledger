/**
 * 验收脚本共用的底部导航操作。
 *
 * 为什么不能像以前那样 tapText(page, '.tabbar__item', '我的')：
 * 底部导航改成自定义 tabBar（app.config 里 tabBar.custom = true）之后，
 * 它是**独立组件树**，不在页面节点树里。automator 的 page.$ / page.$$ 只能看到
 * 页面自己的节点，取不到 tab 项，于是所有「点底栏进某页」的断言都会返回 false。
 *
 * 改用 switchTab 是等价行为：用户点 tab 项时，我们组件里调的就是 Taro.switchTab
 * （见 src/custom-tab-bar/index.tsx）。差别只在于「点击命中」这一步没被覆盖 ——
 * 那一层由真机手点验证，脚本里另外用静态断言守住「页面确实声明为 tab 页」。
 */

const TAB_PATHS = {
  首页: '/pages/home/index',
  流水: '/pages/ledger/index',
  图表: '/pages/stats/index',
  我的: '/pages/settings/index',
};

/**
 * 切到某个底部 tab。
 * @param {object} mp automator 实例
 * @param {'首页'|'流水'|'图表'|'我的'} label
 * @returns {Promise<boolean>} 是否成功切到目标页
 */
async function goTab(mp, label) {
  const url = TAB_PATHS[label];
  if (!url) return false;
  try {
    await mp.switchTab(url);
    // switchTab 返回后页面通常已切换，但渲染首帧未必完成，
    // 调用方一般紧跟 waitForPage，这里只留一点余量
    await new Promise((r) => setTimeout(r, 200));
    return true;
  } catch (err) {
    console.warn(`[nav] switchTab ${label} 失败:`, err?.message ?? err);
    return false;
  }
}

module.exports = { goTab, TAB_PATHS };
