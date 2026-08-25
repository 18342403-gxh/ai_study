/**
 * 全局错误处理中间件
 * 统一处理路由抛出的错误，返回标准 JSON 格式
 */

import type { Request, Response, NextFunction } from 'express'

export interface AppError extends Error {
  statusCode?: number
  code?: string
}

export const errorHandler = (
  err: AppError,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  const statusCode = err.statusCode || 500
  const message = err.message || '内部服务器错误'

  process.stderr.write(`[ERROR] ${statusCode} ${err.stack || err.message}\n`)

  res.status(statusCode).json({
    error: {
      message,
      code: err.code || 'INTERNAL_ERROR',
      ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
    },
  })
}

/**
 * 404 处理中间件
 */
export const notFoundHandler = (req: Request, res: Response) => {
  res.status(404).json({
    error: {
      message: `路由 ${req.method} ${req.originalUrl} 不存在`,
      code: 'NOT_FOUND',
    },
  })
}

/**
 * 异步路由错误捕获装饰器
 * 让 async 路由的 throw 能被 Express 错误中间件捕获
 */
export const asyncHandler = <P, Q, B>(
  fn: (req: Request<P, unknown, B>, res: Response, next: NextFunction) => Promise<unknown>
) => {
  return (req: Request<P, unknown, B>, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}

/**
 * 创建带状态码的错误
 */
export const createError = (message: string, statusCode = 500, code?: string): AppError => {
  const err = new Error(message) as AppError
  err.statusCode = statusCode
  err.code = code
  return err
}
