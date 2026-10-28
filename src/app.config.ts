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
})
