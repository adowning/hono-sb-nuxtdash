import { keepPreviousData, queryOptions } from '@tanstack/vue-query'
import { hc } from 'hono/client'
import type {
  AppType,
  //   ZGetUserSchema,
  //   TGetUserType,
  TGetAllUsersType
} from '../../../backend/src/shared/types'

// type GetMeReturnType = AsyncReturnType<typeof getMe>

type GetMeDataType = Awaited<ReturnType<typeof getMe>> // This gives us Api.Auth.UserInfo

// Helper function to get Supabase auth token
const getSupabaseAuthHeaders = () => {
  let _token = localStorage.getItem('sb-crqbazcsrncvbnapuxcp-auth-token')
  let token
  if (_token) token = JSON.parse(_token)
  const access_token = token?.access_token

  return access_token
    ? {
        Authorization: `Bearer ${access_token}`
      }
    : {}
}

// Create base client without auth headers
const client = hc<AppType>('/api')

// Helper function to make authenticated requests
const makeAuthenticatedRequest = async <T>(
  requestFn: () => Promise<Response>,
  headers: Record<string, string> = {}
): Promise<T> => {
  const authHeaders = getSupabaseAuthHeaders()

  // If we have an auth token, make the request with additional headers
  if (Object.keys(authHeaders).length > 0) {
    // Replicate the request with auth headers
    const res = await client.api.me.$get({
      headers: {
        ...headers,
        ...authHeaders
      }
    })

    if (!res.ok) {
      throw new Error('Failed to fetch data')
    }

    return await res.json()
  }

  // If no auth token, make the original request
  return requestFn()
}

// eslint-disable-next-line prettier/prettier
export const getAllUsers = async ({ query, page, perPage }: TGetAllUsersType) => {
  const authHeaders = getSupabaseAuthHeaders()

  const res = await client.api.me.$get({
    query: {
      query,
      page: String(page),
      perPage: String(perPage)
    },
    headers: authHeaders // Add auth headers to the request
  })

  if (!res.ok) {
    throw new Error('Failed to fetch courses')
  }

  const users = await res.json()
  return users
}

export const getAllUsersQueryOptions = ({ query, page, perPage }: TGetAllUsersType) =>
  queryOptions({
    queryKey: ['get-all-courses', query, page, perPage],
    queryFn: () => getAllUsers({ query, page, perPage }),
    placeholderData: keepPreviousData,
    staleTime: 1000 * 60 * 5
  })

// eslint-disable-next-line prettier/prettier
export const getUserById = async (id: string) => {
  const authHeaders = getSupabaseAuthHeaders()

  const res = await client.api.me.$get({
    param: {
      id: id.toString()
    },
    headers: authHeaders // Add auth headers to the request
  })

  if (!res.ok) {
    throw new Error('Failed to fetch course')
  }

  const data = await res.json()
  return data
}

// eslint-disable-next-line prettier/prettier
export const getMe = async () => {
  const authHeaders = getSupabaseAuthHeaders()
  let _token = localStorage.getItem('sb-crqbazcsrncvbnapuxcp-auth-token')
  let token
  if (_token) token = JSON.parse(_token)
  console.log(token)
  token = token.access_token
  const refresh_token = token.refresh_token
  console.log(token)
  console.log(refresh_token)
  const res = await client.api.me.$get(
    {},
    // authHeaders
    {
      headers: { Authorization: `Bearer ${token}`, refresh_token: refresh_token } // Add auth headers to the request
    }
  )

  if (!res.ok) {
    throw new Error('Failed to fetch course')
  }

  const data = await res.json()
  return data
}
export type { GetMeDataType }
