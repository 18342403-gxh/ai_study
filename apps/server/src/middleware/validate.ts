/**
 * Zod 请求校验中间件
 * 支持对 body / query / params 分别校验
 * 校验失败自动返回 400 + 详细字段错误信息
 */

import { z, type ZodSchema } from 'zod'
import type { Request, Response, NextFunction, RequestHandler } from 'express'
import { createError } from './errorHandler.js'

export interface ValidationSchemas {
  body?: ZodSchema
  query?: ZodSchema
  params?: ZodSchema
}

/**
 * 创建校验中间件工厂
 * 使用：router.post('/', validate({ body: z.object({...}) }), handler)
 */
export const validate = (schemas: ValidationSchemas): RequestHandler => {
  return (req: Request, _res: Response, next: NextFunction) => {
    const errors: Record<string, string[]> = {}

    if (schemas.body) {
      const result = schemas.body.safeParse(req.body)
      if (!result.success) {
        errors.body = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
      }
    }

    if (schemas.query) {
      const result = schemas.query.safeParse(req.query)
      if (!result.success) {
        errors.query = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
      }
    }

    if (schemas.params) {
      const result = schemas.params.safeParse(req.params)
      if (!result.success) {
        errors.params = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
      }
    }

    if (Object.keys(errors).length > 0) {
      const err = createError('请求参数校验失败', 400, 'VALIDATION_ERROR')
      err.message = JSON.stringify(errors)
      return next(err)
    }

    next()
  }
}

/**
 * 预定义的常用 schema 片段
 */
export const commonSchemas = {
  nonEmptyString: z.string().min(1, '不能为空字符串'),
  positiveId: z.string().uuid('必须为合法 UUID'),
  pagination: z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  }),
}
