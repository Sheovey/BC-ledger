export default definePageConfig({
  // 自绘顶部栏：Web 版有副标题「N 笔记录」和右侧加号，系统导航栏只能放一个标题，
  // 关掉默认导航栏后由页面内用 useNavMetrics 补偿状态栏高度与胶囊位置。
  navigationStyle: 'custom',
  backgroundColor: '#f6f4f1',
  // 触底加载：默认 50px 太贴身，稍微多给一点余量；给太大（300+）会一进页面就自动加载一次
  onReachBottomDistance: 100,
});
