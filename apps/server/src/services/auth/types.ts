export type UserRole = 'admin' | 'temp'

export interface AuthUser {
  id: string
  username: string
  role: UserRole
  libraryId: string
  /** 毫秒时间戳；超管为 null */
  expiresAt: number | null
}

export interface UserRowLike {
  id: string
  username: string
  role: string
  libraryId: string
  status: string
  expiresAt: Date | null
}
