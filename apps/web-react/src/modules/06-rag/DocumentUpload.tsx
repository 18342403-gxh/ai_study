/**
 * 知识点 6.1/6.2：文件上传组件
 *
 * 学习要点：
 * - input[type=file] 与 drag/drop 事件实现拖拽上传
 * - File API 读取文件信息和文本内容
 * - 文件格式校验
 * - 上传进度模拟展示
 *
 * 面试相关：
 * - 拖拽上传的事件处理：dragover/dragleave/drop
 * - FileReader API 的使用
 */

import { useState, useCallback, useRef } from 'react'
import { UploadOutline } from 'antd-mobile-icons'

/** 允许的文件类型 */
const ACCEPTED_TYPES = ['.txt', '.md', '.json']
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB

interface DocumentUploadProps {
  onFileLoaded: (name: string, content: string) => void
}

const DocumentUpload: React.FC<DocumentUploadProps> = ({ onFileLoaded }) => {
  const [isDragOver, setIsDragOver] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  /** 校验文件是否合法 */
  const validateFile = (file: File): string | null => {
    const ext = '.' + file.name.split('.').pop()?.toLowerCase()
    if (!ACCEPTED_TYPES.includes(ext)) {
      return `不支持的文件格式，仅支持 ${ACCEPTED_TYPES.join('、')}`
    }
    if (file.size > MAX_FILE_SIZE) {
      return '文件大小不能超过 5MB'
    }
    return null
  }

  /**
   * 📝 面试考点：FileReader 异步读取文件内容
   * readAsText 将文件内容读为字符串
   */
  const handleFile = useCallback(async (file: File) => {
    const validationError = validateFile(file)
    if (validationError) {
      setError(validationError)
      return
    }

    setError('')
    setIsUploading(true)
    setUploadProgress(0)

    // 模拟上传进度（实际项目中用 XHR 的 progress 事件）
    const progressInterval = setInterval(() => {
      setUploadProgress((prev) => Math.min(prev + 20, 90))
    }, 200)

    try {
      // 📝 面试考点：使用 FileReader 读取文件文本内容
      const content = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(new Error('文件读取失败'))
        reader.readAsText(file)
      })

      clearInterval(progressInterval)
      setUploadProgress(100)

      // 通知父组件
      onFileLoaded(file.name, content)

      // 重置状态
      setTimeout(() => {
        setIsUploading(false)
        setUploadProgress(0)
      }, 500)
    } catch (err) {
      clearInterval(progressInterval)
      setError(err instanceof Error ? err.message : '文件处理失败')
      setIsUploading(false)
      setUploadProgress(0)
    }
  }, [onFileLoaded])

  /**
   * 📝 面试考点：拖拽上传的事件处理
   * - dragover: 必须 preventDefault 才能接收 drop
   * - dragleave: 离开时取消高亮
   * - drop: 从 dataTransfer.files 获取文件
   */
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    // 重置 input 以便重复选择同一文件
    if (inputRef.current) inputRef.current.value = ''
  }, [handleFile])

  return (
    <div>
      {/* 拖拽上传区域 */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
          isDragOver
            ? 'border-indigo-400 bg-indigo-500/10'
            : 'border-slate-600 hover:border-slate-500'
        }`}
      >
        <UploadOutline className="text-2xl text-slate-400 mx-auto mb-2" />
        <p className="text-sm text-slate-400">点击或拖拽文件到这里</p>
        <p className="text-xs text-slate-500 mt-1">支持 TXT、MD、JSON，最大 5MB</p>
      </div>

      {/* 隐藏的 file input */}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(',')}
        onChange={handleInputChange}
        className="hidden"
      />

      {/* 上传进度 */}
      {isUploading && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span>上传中...</span>
            <span>{uploadProgress}%</span>
          </div>
          <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500 rounded-full transition-all duration-300"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* 错误提示 */}
      {error && (
        <p className="mt-2 text-xs text-rose-400">{error}</p>
      )}
    </div>
  )
}

export default DocumentUpload
