import { create } from 'zustand'
import { setAccessToken } from '@/lib/api'

interface User {
  sub: string
  workspaceId: string
  role: 'ADMIN' | 'MEMBER'
}

interface AuthState {
  user: User | null
  isAuthenticated: boolean
  setUser: (user: User | null, token: string | null) => void
  clear: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  setUser: (user, token) => {
    setAccessToken(token)
    set({ user, isAuthenticated: !!user })
  },
  clear: () => {
    setAccessToken(null)
    set({ user: null, isAuthenticated: false })
  },
}))
