import { logout } from '@replay-crate/api-client'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useCallback } from 'react'
import { api } from './api.ts'

export function useLogout() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  return useCallback(async () => {
    await logout(api)
    // Drop every cached query so nothing from this account survives.
    queryClient.clear()
    await navigate({ to: '/connect' })
  }, [queryClient, navigate])
}
