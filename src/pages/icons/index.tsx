import { View, Text } from '@tarojs/components';
import { Icon } from '../../components/Icon';
import { ICON_NAMES } from '../../components/icon-names';
import './index.scss';

/**
 * 图标总览页：把 52 个图标全部渲染出来做视觉核对。
 * 迁移期间作为回归页保留——改过图标后打开这一页，一眼就能看出哪个转坏了。
 */
export default function IconsPage() {
  return (
    <View className='wrap'>
      <Text className='title'>图标总览（{ICON_NAMES.length} 个）</Text>

      <View className='grid'>
        {ICON_NAMES.map((n) => (
          <View className='cell' key={n}>
            <Icon name={n} size={24} />
            <Text className='cell__name'>{n}</Text>
          </View>
        ))}
      </View>

      <Text className='title'>颜色继承（父级 color 不同）</Text>
      <View className='row'>
        <View className='swatch c-red'>
          <Icon name='wallet' size={26} />
          <Text className='swatch__t'>#e54d42</Text>
        </View>
        <View className='swatch c-green'>
          <Icon name='wallet' size={26} />
          <Text className='swatch__t'>#1a8f5f</Text>
        </View>
        <View className='swatch c-gray'>
          <Icon name='wallet' size={26} />
          <Text className='swatch__t'>#999999</Text>
        </View>
        <View className='swatch c-dark'>
          <Icon name='wallet' size={26} />
          <Text className='swatch__t'>#1f2329</Text>
        </View>
      </View>

      <Text className='title'>尺寸 16 / 20 / 28 / 36</Text>
      <View className='row'>
        <Icon name='chart' size={16} />
        <Icon name='chart' size={20} />
        <Icon name='chart' size={28} />
        <Icon name='chart' size={36} />
      </View>

      <Text className='title'>兜底与加粗变体</Text>
      <View className='row'>
        <View className='swatch'>
          <Icon name='definitely-not-exist' size={26} />
          <Text className='swatch__t'>拼错名→other</Text>
        </View>
        <View className='swatch'>
          <Icon name='plus' size={26} strokeWidth={2.2} />
          <Text className='swatch__t'>plus 2.2</Text>
        </View>
        <View className='swatch'>
          <Icon name='plus' size={26} />
          <Text className='swatch__t'>plus 1.65</Text>
        </View>
      </View>
    </View>
  );
}
