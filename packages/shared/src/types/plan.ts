/**
 * 长期规划类型 — AI 生成与手动录入共用
 * 与 apps/server/src/routes/plans.ts 的 API 形状保持一致（camelCase）
 */

export type PlanStatus = 'draft' | 'active' | 'done' | 'archived'

export type PlanSourceType = 'conversation' | 'document' | 'manual'

export interface PlanStage {
  id?: string
  title: string
  description?: string
  /** 阶段目标时间（毫秒时间戳） */
  targetAt?: number | null
  done?: boolean
}

/** 草稿的依据来源：条目或文档片段 */
export interface PlanSource {
  type: 'entry' | 'chunk'
  id: string
  label: string
  snippet: string
}

export interface Plan {
  id: string
  userId: string
  libraryId: string
  title: string
  /** 规划目标与背景 */
  goal: string
  status: PlanStatus
  startAt: number | null
  endAt: number | null
  /** 0–100 */
  progress: number
  stages: PlanStage[]
  sourceType: PlanSourceType
  sourceRef: string | null
  createdAt: number
  updatedAt: number
  archivedAt: number | null
}

export interface CreatePlanInput {
  title: string
  goal?: string
  status?: PlanStatus
  startAt?: number | null
  endAt?: number | null
  progress?: number
  stages?: PlanStage[]
  sourceType?: PlanSourceType
  sourceRef?: string | null
  userId?: string
  libraryId?: string
}

export type UpdatePlanInput = Partial<Omit<CreatePlanInput, 'userId' | 'sourceType' | 'sourceRef'>>

/** AI 生成的结构化规划草稿 */
export interface PlanDraft {
  title: string
  goal: string
  startAt: number | null
  endAt: number | null
  stages: PlanStage[]
  /** 命中的知识库依据；为空表示知识库未覆盖 */
  sources: PlanSource[]
  grounded: boolean
}
