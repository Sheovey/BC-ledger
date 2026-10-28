import { defineConfig, type UserConfigExport } from '@tarojs/cli'
import path from 'path'
import devConfig from './dev'
import prodConfig from './prod'

// designWidth 取 375 而不是 Taro 默认的 750：
// 现有 Web 版的样式全部按 375 宽设计稿写成 px，取 375 后 1px 自动转 2rpx，
// 样式文件可以整份搬过来不改数字。若取 750，所有尺寸会缩成一半。
export default defineConfig<'webpack5'>(async (merge) => {
  const baseConfig: UserConfigExport<'webpack5'> = {
    projectName: 'ledger-taro',
    date: '2026-10-27',
    designWidth: 375,
    deviceRatio: {
      640: 2.34 / 2,
      750: 1,
      828: 1.81 / 2,
      375: 2 / 1,
    },
    sourceRoot: 'src',
    outputRoot: 'dist',
    // 与 Web 版保持同一套路径别名，数据层（store/db/utils）可直接复用，不必逐个改相对路径
    alias: {
      '@': path.resolve(__dirname, '..', 'src'),
    },
    plugins: [],
    defineConstants: {},
    copy: {
      patterns: [],
      options: {},
    },
    framework: 'react',
    compiler: {
      type: 'webpack5',
      // prebundle 关掉：它把依赖预打包成 chunk，调试时堆栈失真；包体积验证阶段先要可读产物
      prebundle: { enable: false },
    },
    cache: {
      // 开启持久化缓存：每次全量编译约 3-4 分钟，迁页面阶段要反复编译，缓存能显著缩短二次构建
      enable: true,
    },
    mini: {
      // 关键：WXSS 里带 SVG data-uri 时，CssMinimizerPlugin（cssnano）会卡死在
      // webpack sealing 92% 的 "asset processing" 阶段，日志不再推进。
      // 这里只摘掉 CSS 压缩器，保留 JS 压缩；WXSS 本身很小，未压缩的代价约每页几百字节。
      webpackChain(chain) {
        // webpack-chain 的运行时对象把 minimizer 存在 Map 上（minimizers），
        // 但它的 TS 声明里只写了 .minimizer(name) 方法，直接访问会报 TS2551。
        // 这里只做一次窄类型断言，避免把整条链降级成 any。
        const minimizers = (
          chain.optimization as unknown as {
            minimizers: Map<string, unknown>;
          }
        ).minimizers
        let keys: string[] = []
        try {
          keys = Object.keys(minimizers.entries())
        } catch (e) {
          keys = ['(无法枚举)']
        }
        console.log('[build] minimizer keys =', keys.join(', '))
        // Taro 把 CSS 压缩器注册为 cssoWebpackPlugin（历史名），不是 csso；
        // 它处理 WXSS 中的 SVG data-uri 会在 asset processing 阶段卡死。
        const candidates = ['cssoWebpackPlugin', 'css', 'csso', 'cssMinimizer', 'CssMinimizerPlugin']
        for (const k of candidates) {
          if (minimizers.has(k)) {
            minimizers.delete(k)
            console.log('[build] 已移除 minimizer:', k)
          }
        }
      },
      postcss: {
        pxtransform: {
          enable: true,
          config: {},
        },
        cssModules: {
          enable: false,
        },
      },
    },
    h5: {
      publicPath: '/',
      staticDirectory: 'static',
      output: {
        filename: 'js/[name].[hash:8].js',
        chunkFilename: 'js/[name].[chunkhash:8].js',
      },
      postcss: {
        autoprefixer: {
          enable: true,
        },
        cssModules: {
          enable: false,
        },
      },
    },
  }

  if (process.env.NODE_ENV === 'development') {
    return merge({}, baseConfig, devConfig)
  }
  return merge({}, baseConfig, prodConfig)
})
