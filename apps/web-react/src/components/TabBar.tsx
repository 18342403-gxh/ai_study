import { Link, useLocation } from 'react-router-dom'
import { AppOutline, GlobalOutline, MessageOutline, SetOutline, AppstoreOutline } from 'antd-mobile-icons'

interface TabItem {
  path: string
  icon: React.ReactNode
  label: string
}

const tabs: TabItem[] = [
  { path: '/', icon: <AppOutline />, label: '首页' },
  { path: '/m1', icon: <GlobalOutline />, label: 'API' },
  { path: '/m4', icon: <MessageOutline />, label: '聊天' },
  { path: '/m5', icon: <SetOutline />, label: '工具' },
  { path: '/m7', icon: <AppstoreOutline />, label: '更多' },
]

const TabBar: React.FC = () => {
  const location = useLocation()

  return (
    <nav className="fixed bottom-0 left-0 right-0 h-14 glass-nav pb-[env(safe-area-inset-bottom)] z-50">
      <div className="flex items-center justify-around h-full">
        {tabs.map((tab) => {
          const isActive =
            tab.path === '/'
              ? location.pathname === '/'
              : location.pathname.startsWith(tab.path)

          return (
            <Link
              key={tab.path}
              to={tab.path}
              className={`min-w-[44px] min-h-[44px] flex flex-col items-center justify-center transition-colors ${
                isActive ? 'text-indigo-400' : 'text-slate-500'
              }`}
            >
              <span className="text-xl">{tab.icon}</span>
              <span className="text-xs mt-0.5">{tab.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}

export default TabBar
