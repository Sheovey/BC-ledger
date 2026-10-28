export default definePageConfig({
  // 自绘顶部栏：Web 版记账页顶部是「返回 + 标题 + 保存」，用系统导航栏放不下保存按钮，
  // 因此关掉默认导航栏，状态栏高度在页面内用 getWindowInfo().statusBarHeight 补偿。
  navigationStyle: 'custom',
  // 页面本身不滚，滚动交给 .record__scroll，避免键盘弹起时整页跳动
  disableScroll: true,
  backgroundColor: '#f6f4f1',
});
