import type { AuthUser } from '../services/auth/types.js'

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthUser
    }
  }
}

export {}
