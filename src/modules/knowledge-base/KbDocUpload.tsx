/**
 * 知识库文档上传组件
 * 上传到后端 /api/documents/upload
 */

import { useState, useCallback, useRef } from 'react'
import { UploadOutline } from 'antd-mobile-icons'

interface KbDocUploadProps {
  apiBase: string
  onComplete: () => void
}

const KbDocUpload: React.FC<KbDocUploadProps> = ({ apiBase, onComplete }) => {
  const [isDragOver, setIsDragOver] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const handleUpload = useCallback(async (file: File) => {
    setError('')
    setIsUploading(true)
    setUploadProgress(0)

    // 模拟进度（实际用 XHR 的 progress 事件更准确）
    const progressTimer = setInterval(() => {
      setUploadProgress((prev) => Math.min(prev + 15, 85))
    }, 300)

    try {
      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch(`${apiBase}/documents/upload`, {
        method: 'POST',
        body: formData,
      })

      clearInterval(progressTimer)

      if (!res.ok) {
        const errData = await res.json()
        throw new Error(errData.error || '上传失败')
      }

      setUploadProgress(100)
      onComplete()

      setTimeout(() => {
        setIsUploading(false)
        setUploadProgress(0)
      }, 500)
    } catch (err) {
      clearInterval(progressTimer)
      setError(err instanceof Error ? err.message : '上传失败')
      setIsUploading(false)
      setUploadProgress(0)
    }
  }, [apiBase, onComplete])

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
    if (file) handleUpload(file)
  }, [handleUpload])

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleUpload(file)
    if (inputRef.current) inputRef.current.value = ''
  }, [handleUpload])

  return (
    <div>
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
        <p className="text-sm text-slate-400">点击或拖拽文件上传到知识库</p>
        <p className="text-xs text-slate-500 mt-1">支持 TXT、MD、JSON、PDF，最大 10MB</p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".txt,.md,.json,.pdf"
        onChange={handleInputChange}
        className="hidden"
      />

      {isUploading && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span>上传并向量化中...</span>
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

      {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
    </div>
  )
}

export default KbDocUpload
