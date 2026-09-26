import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'

/\*\*

- Vue 3 + Vitest 组件测试模板
-
- 推荐用法：
- 1.  用 mount() 挂载组件
- 2.  用 wrapper.find() / wrapper.findAll() 找元素
- 3.  用 wrapper.trigger() 触发事件
- 4.  用 nextTick() 等待 DOM 更新
-
- 示例：
- const wrapper = mount(MyComponent, { props: { title: 'hello' } })
- expect(wrapper.text()).toContain('hello')
- await wrapper.find('button').trigger('click')
  \*/
  export function useComponentTest(component: any, options = {}) {
  return mount(component, {
  global: {
  plugins: [],
  stubs: {},
  },
  ...options,
  })
  }
