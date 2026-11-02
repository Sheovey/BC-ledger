export default defineAppConfig({
  // 数组第一项是小程序启动页，必须是首页
  pages: [
    'pages/home/index',
    'pages/ledger/index',
    'pages/stats/index',
    'pages/settings/index',
    'pages/record/index',
    'pages/accounts/index',
    'pages/categories/index',
    'pages/books/index',
    'pages/budget/index',
    'pages/projects/index',
    'pages/templates/index',
    // 以下是开发页，正式包不注册（Taro 只编译 app.config 里列出的页面，
    // 不注册即不进产物）。需要看图标总览或验证工具链时临时加回：
    // 'pages/icons/index'      图标总览
    // 'pages/icon-test/index'  图标继承色验证
    // 'pages/index/index'      工具链探针
  ],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#0e6c53',
    navigationBarTitleText: '半寸册',
    navigationBarTextStyle: 'white',
    backgroundColor: '#f5f6f7',
  },
  /**
   * 底部导航。
   *
   * custom: true —— 视觉仍由 src/custom-tab-bar 自己画（含中间凸起的「记一笔」，
   * 原生 tabBar 做不了凸起布局），但**页面归属 tab 页**这件事交给框架，
   * 于是切 tab 走 switchTab，页面常驻、不重建。
   *
   * 之前没有这段配置，四个 tab 是普通页面，切换靠 Taro.redirectTo —— 语义是
   * 「销毁当前页 + 新建目标页」，每点一次等于重建整页。实测每次 280~500ms，
   * 峰值 3s，且反复重建会让耗时逐轮递增（越用越卡）。加这段后稳态降到 30~90ms（48 次连续切换实测，见下）。
   *
   * list 在 custom 模式下不决定渲染，但必须完整声明：框架靠它识别哪些是 tab 页。
   * iconPath 可省（官方示例即如此），我们本来也不用它。
   */
  tabBar: {
    custom: true,
    color: '#8a9791',
    selectedColor: '#0e6c53',
    backgroundColor: '#ffffff',
    borderStyle: 'white',
    list: [
      { pagePath: 'pages/home/index', text: '首页' },
      { pagePath: 'pages/ledger/index', text: '流水' },
      { pagePath: 'pages/stats/index', text: '图表' },
      { pagePath: 'pages/settings/index', text: '我的' },
    ],
  },
})
