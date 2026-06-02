import { Link } from 'react-router-dom'

interface ModuleItem {
  id: number
  emoji: string
  title: string
  description: string
  route: string
  bgColor: string
}

const modules: ModuleItem[] = [
  {
    id: 1,
    emoji: '📡',
    title: 'AI API 基础调用',
    description: '理解大模型 API 调用全流程',
    route: '/m1',
    bgColor: 'bg-blue-100',
  },
  {
    id: 2,
    emoji: '🌊',
    title: '流式响应',
    description: 'SSE 协议与实时数据渲染',
    route: '/m2',
    bgColor: 'bg-cyan-100',
  },
  {
    id: 3,
    emoji: '🎯',
    title: 'Prompt 工程',
    description: '构建高质量对话提示词',
    route: '/m3',
    bgColor: 'bg-orange-100',
  },
  {
    id: 4,
    emoji: '💬',
    title: '聊天界面',
    description: '移动端 Chat UI 开发',
    route: '/m4',
    bgColor: 'bg-green-100',
  },
  {
    id: 5,
    emoji: '🔧',
    title: 'Function Calling',
    description: '工具调用与执行编排',
    route: '/m5',
    bgColor: 'bg-purple-100',
  },
  {
    id: 6,
    emoji: '📚',
    title: 'RAG 集成',
    description: '知识库检索增强生成',
    route: '/m6',
    bgColor: 'bg-amber-100',
  },
  {
    id: 7,
    emoji: '🤖',
    title: 'AI Agent',
    description: '智能体交互设计',
    route: '/m7',
    bgColor: 'bg-rose-100',
  },
]

const Home: React.FC = () => {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="px-4 pt-8 pb-4">
        <h1 className="text-2xl font-bold text-gray-900">AI 前端开发实验室</h1>
        <p className="text-sm text-gray-500 mt-1">从零掌握 AI 应用开发核心技能</p>
      </header>

      {/* Module Cards */}
      <div className="pb-20">
        {modules.map((module) => (
          <Link
            key={module.id}
            to={module.route}
            className="mx-4 mb-3 bg-white rounded-xl shadow-sm p-4 flex items-center gap-3 active:scale-[0.98] transition-transform block"
          >
            <div
              className={`w-11 h-11 rounded-full ${module.bgColor} flex items-center justify-center text-xl shrink-0`}
            >
              {module.emoji}
            </div>
            <div className="min-w-0">
              <div className="font-medium text-gray-900">
                {module.id}. {module.title}
              </div>
              <div className="text-sm text-gray-500 truncate">{module.description}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}

export default Home
