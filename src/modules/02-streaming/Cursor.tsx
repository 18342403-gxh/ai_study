/**
 * 知识点 2.6：光标闪烁动画
 *
 * 学习要点：
 * - CSS animation 实现 blink 效果
 * - 条件显示（仅生成中显示）
 * - inline 元素定位跟随文字末尾
 */

const Cursor: React.FC = () => {
  return (
    // 📝 面试考点：CSS animation 实现打字机光标闪烁
    <span className="inline-block w-0.5 h-4 bg-gray-800 ml-0.5 align-middle animate-pulse" />
  )
}

export default Cursor
