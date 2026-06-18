import { Link } from 'react-router-dom'
import {
  GlobalOutline,
  PlayOutline,
  FireFill,
  MessageOutline,
  SetOutline,
  ContentOutline,
  SmileOutline,
} from 'antd-mobile-icons'

interface ModuleItem {
  id: number
  icon: React.ReactNode
  title: string
  description: string
  route: string
}

const modules: ModuleItem[] = [
  { id: 1, icon: <GlobalOutline />, title: 'AI API 基础调用', description: '理解大模型 API 调用全流程', route: '/m1' },
  { id: 2, icon: <PlayOutline />, title: '流式响应', description: 'SSE 协议与实时数据渲染', route: '/m2' },
  { id: 3, icon: <FireFill />, title: 'Prompt 工程', description: '构建高质量对话提示词', route: '/m3' },
  { id: 4, icon: <MessageOutline />, title: '聊天界面', description: '移动端 Chat UI 开发', route: '/m4' },
  { id: 5, icon: <SetOutline />, title: 'Function Calling', description: '工具调用与执行编排', route: '/m5' },
  { id: 6, icon: <ContentOutline />, title: 'RAG 集成', description: '知识库检索增强生成', route: '/m6' },
  { id: 7, icon: <SmileOutline />, title: 'AI Agent', description: '智能体交互设计', route: '/m7' },
]

const Home: React.FC = () => {
  return (
    <div className="min-h-screen tech-gradient-bg">
      {/* Header */}
      <header className="px-4 pt-10 pb-6">
        <h1 className="text-2xl font-bold gradient-text">AI 前端开发实验室</h1>
        <p className="text-sm text-slate-400 mt-1">从零掌握 AI 应用开发核心技能</p>
      </header>

      {/* Module Cards */}
      <div className="px-4 pb-24 space-y-3">
        {modules.map((module) => (
          <Link
            key={module.id}
            to={module.route}
            className="glass-card rounded-xl p-4 flex items-center gap-3 active:scale-[0.98] transition-transform block"
          >
            <div className="w-10 h-10 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-lg shrink-0">
              {module.icon}
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-medium text-slate-100 text-sm">
                {module.id}. {module.title}
              </div>
              <div className="text-xs text-slate-400 truncate mt-0.5">{module.description}</div>
            </div>
            <span className="text-slate-500 text-sm">›</span>
          </Link>
        ))}
      </div>
    </div>
  )
}

export default Home
