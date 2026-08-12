import { useNavigate } from 'react-router-dom'
import { LeftOutline } from 'antd-mobile-icons'

interface LayoutProps {
  title: string
  showBack?: boolean
  children: React.ReactNode
}

const Layout: React.FC<LayoutProps> = ({ title, showBack = true, children }) => {
  const navigate = useNavigate()

  return (
    <div className="h-screen flex flex-col tech-gradient-bg">
      {/* 顶部标题栏 */}
      <header className="h-11 flex items-center px-4 glass-nav shrink-0">
        {showBack && (
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center -ml-2 text-slate-400"
            aria-label="返回"
          >
            <LeftOutline />
          </button>
        )}
        <h1 className="text-sm font-medium text-slate-200 truncate">
          {title}
        </h1>
      </header>

      {/* 内容区域 */}
      <main className="flex-1 overflow-y-auto pb-14">
        {children}
      </main>
    </div>
  )
}

export default Layout
