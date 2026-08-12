/**
 * 知识库文档上传组件 — Dify 风格
 */

import { useState, useCallback, useRef } from 'react'
import { AddCircleOutline } from 'antd-mobile-icons'

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

    const progressTimer = setInterval(() => {
      setUploadProgress((prev) => Math.min(prev + 12, 85))
    }, 250)

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
      setTimeout(() => { setIsUploading(false); setUploadProgress(0) }, 600)
    } catch (err) {
      clearInterval(progressTimer)
      setError(err instanceof Error ? err.message : '上传失败')
      setIsUploading(false)
      setUploadProgress(0)
    }
  }, [apiBase, onComplete])

  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragOver(true) }, [])
  const handleDragLeave = useCallback(() => { setIsDragOver(false) }, [])
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragOver(false)
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
        className={`relative overflow-hidden rounded-xl border border-dashed transition-all cursor-pointer group ${
          isDragOver
            ? 'border-indigo-400 bg-indigo-500/10 scale-[1.01]'
            : 'border-slate-600/60 hover:border-indigo-500/50 hover:bg-slate-800/30'
        }`}
      >
        {/* 渐变背景装饰 */}
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 to-cyan-500/5 opacity-0 group-hover:opacity-100 transition-opacity" />

        <div className="relative px-4 py-5 text-center">
          <div className="w-10 h-10 mx-auto mb-2 rounded-full bg-indigo-500/10 flex items-center justify-center">
            <AddCircleOutline className="text-xl text-indigo-400" />
          </div>
          <p className="text-sm text-slate-300 font-medium">上传文档到知识库</p>
          <p className="text-xs text-slate-500 mt-1">拖拽文件或点击选择 · PDF / TXT / MD / JSON · 最大 10MB</p>
        </div>
      </div>

      <input ref={inputRef} type="file" accept=".txt,.md,.json,.pdf" onChange={handleInputChange} className="hidden" />

      {/* 上传进度 */}
      {isUploading && (
        <div className="mt-3 glass-card rounded-lg px-3 py-2">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-slate-300">解析并向量化中...</span>
            <span className="text-indigo-400 font-medium">{uploadProgress}%</span>
          </div>
          <div className="h-1 bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${uploadProgress}%`,
                background: 'linear-gradient(90deg, #6366f1, #06b6d4)',
              }}
            />
          </div>
        </div>
      )}

      {error && (
        <div className="mt-2 px-3 py-1.5 bg-rose-500/10 border border-rose-500/20 rounded-lg text-xs text-rose-400">
          {error}
        </div>
      )}
    </div>
  )
}

export default KbDocUpload
