/// <reference types="@tarojs/taro" />

declare module '*.png'
declare module '*.gif'
declare module '*.jpg'
declare module '*.jpeg'
declare module '*.svg'
declare module '*.css'
declare module '*.less'
declare module '*.scss'
declare module '*.sass'
declare module '*.styl'

// Taro 的编译期宏，由 babel 插件注入，运行时不存在的全局函数
declare const defineAppConfig: <T>(config: T) => T
declare const definePageConfig: <T>(config: T) => T

declare namespace NodeJS {
  interface ProcessEnv {
    /** 当前编译平台 */
    TARO_ENV: 'weapp' | 'swan' | 'alipay' | 'h5' | 'rn' | 'tt' | 'quickapp' | 'qq' | 'jd'
    /** 小程序端恒为 production/development */
    NODE_ENV: 'development' | 'production'
    TARO_APP_ID: string
  }
}
