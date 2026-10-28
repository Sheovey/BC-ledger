import { View, Text } from '@tarojs/components'
import { useState } from 'react'
import './index.scss'

/**
 * 工具链验证页。
 * 目的只有一个：确认 Taro/React/TS/SCSS 四件事在小程序端都能编译并渲染，
 * 排除完工具链问题后再迁移真实页面，避免把环境问题误判成业务代码问题。
 */
export default function Index() {
  const [count, setCount] = useState(0)

  return (
    <View className='probe'>
      <View className='probe__card'>
        <Text className='probe__title'>工具链验证通过</Text>
        <Text className='probe__desc'>Taro 4 + React 18 + TypeScript + SCSS</Text>
      </View>

      <View className='probe__card'>
        <Text className='probe__label'>状态与事件绑定</Text>
        <Text className='probe__count'>{count}</Text>
        <View className='probe__btn' onClick={() => setCount(count + 1)}>
          <Text className='probe__btn-text'>点我 +1</Text>
        </View>
      </View>

      <Text className='probe__hint'>designWidth 375：1px 已转为 2rpx，下方方框宽 100px 应等于半屏</Text>
      <View className='probe__ruler' />
    </View>
  )
}
