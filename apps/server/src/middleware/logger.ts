/**
 * 请求日志中间件
 * 记录方法、路径、状态码、耗时
 */

import type { Request, Response, NextFunction } from 'express'

export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const start = process.hrtime.bigint()

  res.on('finish', () => {
    const diffNs = Number(process.hrtime.bigint() - start)
    const ms = (diffNs / 1e6).toFixed(2)
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'
    process.stdout.write(
      `[${level.toUpperCase()}] ${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms\n`
    )
  })

  next()
}
