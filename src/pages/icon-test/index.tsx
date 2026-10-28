import { View, Text, Image } from '@tarojs/components';
import './index.scss';

const BACK_URI =
  'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%23000%22%20stroke-width%3D%221.65%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22M15%205%208%2012l7%207%22%2F%3E%3C%2Fsvg%3E';

export default function IconTest() {
  return (
    <View className='page'>
      <Text className='hint'>图标渲染方案实测（同一图标，四种承载方式）</Text>

      <View className='row'>
        <Text className='label'>A 内联 svg</Text>
        <Text className='note'>已排除：WXML 无 svg 标签，且导致编译卡死</Text>
      </View>

      <View className='row'>
        <Text className='label'>B mask + 继承色</Text>
        <View className='demo red'>
          <View className='ico ico-mask' />
        </View>
      </View>

      <View className='row'>
        <Text className='label'>B2 mask + 固定色</Text>
        <View className='demo'>
          <View className='ico ico-mask ico-fixed' />
        </View>
      </View>

      <View className='row'>
        <Text className='label'>C background-image</Text>
        <View className='demo'>
          <View className='ico ico-bg' />
        </View>
      </View>

      <View className='row'>
        <Text className='label'>D Image 组件</Text>
        <View className='demo'>
          <Image className='ico' src={BACK_URI} mode='aspectFit' />
        </View>
      </View>

      <Text className='hint'>左侧标签右侧图标；红色行用于检验颜色能否继承</Text>
    </View>
  );
}
