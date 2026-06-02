import { lazy, Suspense } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import Home from './pages/Home'
import TabBar from './components/TabBar'

const ApiBasics = lazy(() => import('./modules/01-api-basics/ApiBasics'))
const Streaming = lazy(() => import('./modules/02-streaming/Streaming'))
const PromptLab = lazy(() => import('./modules/03-prompt/PromptLab'))
const ChatPage = lazy(() => import('./modules/04-chat-ui/ChatPage'))
const FunctionCalling = lazy(() => import('./modules/05-function-calling/FunctionCalling'))
const RagPage = lazy(() => import('./modules/06-rag/RagPage'))
const AgentPage = lazy(() => import('./modules/07-agent/AgentPage'))

const Loading: React.FC = () => (
  <div className="flex items-center justify-center h-screen">
    <span className="text-gray-400 text-sm">加载中...</span>
  </div>
)

const App: React.FC = () => {
  const location = useLocation()
  const hideTabBar = location.pathname.startsWith('/m4')

  return (
    <>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/m1" element={<ApiBasics />} />
          <Route path="/m2" element={<Streaming />} />
          <Route path="/m3" element={<PromptLab />} />
          <Route path="/m4" element={<ChatPage />} />
          <Route path="/m5" element={<FunctionCalling />} />
          <Route path="/m6" element={<RagPage />} />
          <Route path="/m7" element={<AgentPage />} />
        </Routes>
      </Suspense>
      {!hideTabBar && <TabBar />}
    </>
  )
}

export default App
