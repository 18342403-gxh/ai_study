import { useNavigate } from 'react-router-dom'

interface LayoutProps {
  title: string
  showBack?: boolean
  children: React.ReactNode
}

const Layout: React.FC<LayoutProps> = ({ title, showBack = true, children }) => {
  const navigate = useNavigate()

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* 顶部标题栏 */}
      <header className="h-11 flex items-center px-4 bg-white border-b border-gray-100 shrink-0">
        {showBack && (
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center -ml-2"
            aria-label="返回"
          >
            <span className="text-lg text-gray-700">←</span>
          </button>
        )}
        <h1 className="text-base font-medium text-gray-900 truncate">
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
