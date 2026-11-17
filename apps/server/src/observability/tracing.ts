/**
 * OpenTelemetry 语义化追踪（P0 · O1-O10）
 *
 * 默认关闭（OTEL_ENABLED!=='1'）：所有 span API 退化为 no-op，不引入额外依赖行为，
 * 也不要求部署侧存在 collector。开启后通过 OTLP/HTTP 导出。
 *
 * 环境变量：
 *   OTEL_ENABLED=1
 *   OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318/v1/traces
 *   OTEL_SERVICE_NAME=ai-study-server
 *   OTEL_TRACES_SAMPLER_ARG=0.1   # 采样率
 */

import {
  context as otelContext,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
  type Attributes,
  type Span,
  type SpanOptions,
} from '@opentelemetry/api'

const TRACER_NAME = 'ai-study-server'

export const tracer = trace.getTracer(TRACER_NAME)

export const isTracingEnabled = (): boolean => process.env.OTEL_ENABLED === '1'

let shuttingDown: (() => Promise<void>) | null = null

/** 启动 SDK；未开启或初始化失败时保持 no-op，不阻塞服务。 */
export const initTracing = async (): Promise<void> => {
  if (!isTracingEnabled() || shuttingDown) return

  try {
    const [{ NodeSDK }, exporterMod, resourcesMod, semconvMod] = await Promise.all([
      import('@opentelemetry/sdk-node'),
      import('@opentelemetry/exporter-trace-otlp-http'),
      import('@opentelemetry/resources'),
      import('@opentelemetry/semantic-conventions'),
    ])

    const serviceName = process.env.OTEL_SERVICE_NAME ?? 'ai-study-server'
    const serviceNameKey =
      (semconvMod as Record<string, unknown>).ATTR_SERVICE_NAME ?? 'service.name'

    // 兼容不同版本的 resources 导出（resourceFromAttributes / Resource）
    const resources = resourcesMod as unknown as {
      resourceFromAttributes?: (attrs: Record<string, unknown>) => unknown
    }
    const resource =
      typeof resources.resourceFromAttributes === 'function'
        ? resources.resourceFromAttributes({ [serviceNameKey as string]: serviceName })
        : undefined

    const exporterEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    const exporter =
      exporterEndpoint && typeof exporterMod.OTLPTraceExporter === 'function'
        ? new exporterMod.OTLPTraceExporter({ url: exporterEndpoint })
        : undefined

    const sdk = new NodeSDK({
      ...(resource ? { resource } : {}),
      ...(exporter ? { traceExporter: exporter } : {}),
    } as ConstructorParameters<typeof NodeSDK>[0])

    sdk.start()
    shuttingDown = async () => {
      // collector 不可用时 shutdown 可能 reject，不能让它影响进程退出
      try {
        await sdk.shutdown()
      } catch {
        /* ignore exporter shutdown failure */
      }
    }
  } catch {
    // 追踪是旁路能力，初始化失败不阻断主流程
    shuttingDown = null
  }
}

/** 优雅关闭（可选，在 SIGTERM 时调用） */
export const shutdownTracing = async (): Promise<void> => {
  await shuttingDown?.()
  shuttingDown = null
}

const normalizeError = (err: unknown): Error =>
  err instanceof Error ? err : new Error(String(err))

/**
 * 在活动 span 中执行异步逻辑；自动记录异常、设置 ERROR 状态并结束 span。
 */
export const withSpan = async <T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
  options: Partial<SpanOptions> = {},
): Promise<T> => {
  if (!isTracingEnabled()) return fn(trace.getActiveSpan() ?? tracer.startSpan(name))

  return tracer.startActiveSpan(
    name,
    { kind: SpanKind.INTERNAL, ...options, attributes },
    async (span) => {
      try {
        const result = await fn(span)
        span.setStatus({ code: SpanStatusCode.OK })
        return result
      } catch (err) {
        span.recordException(normalizeError(err))
        span.setStatus({ code: SpanStatusCode.ERROR, message: normalizeError(err).message })
        throw err
      } finally {
        span.end()
      }
    },
  )
}

/** 同步版本，用于不返回 Promise 的小段逻辑 */
export const withSpanSync = <T>(name: string, attributes: Attributes, fn: (span: Span) => T): T => {
  if (!isTracingEnabled()) return fn(trace.getActiveSpan() ?? tracer.startSpan(name))

  return tracer.startActiveSpan(name, { attributes }, (span) => {
    try {
      const result = fn(span)
      span.setStatus({ code: SpanStatusCode.OK })
      return result
    } catch (err) {
      span.recordException(normalizeError(err))
      span.setStatus({ code: SpanStatusCode.ERROR, message: normalizeError(err).message })
      throw err
    } finally {
      span.end()
    }
  })
}

/** 从入站 header 提取 W3C traceparent，返回带父上下文的 span 与上下文 */
export const startServerSpan = (
  name: string,
  headers: Record<string, unknown>,
  attributes: Attributes,
): { span: Span; ctx: ReturnType<typeof trace.setSpan> } => {
  const parentCtx = propagation.extract(otelContext.active(), headers)
  const span = tracer.startSpan(name, { kind: SpanKind.SERVER, attributes }, parentCtx)
  return { span, ctx: trace.setSpan(parentCtx, span) }
}

/** 获取当前活动 traceId（未开启时返回 undefined），用于把日志与 trace 对齐 */
export const currentTraceId = (): string | undefined => trace.getActiveSpan()?.spanContext().traceId
