import { ref, readonly, shallowRef } from 'vue'
import { useRouter } from 'vue-router'
import {
  createClient,
  type Session,
  type User,
  type RealtimeChannel,
} from '@supabase/supabase-js'
import mitt from 'mitt'

// --- 1. Setup Supabase Client ---
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})

// --- 2. Setup Event Emitter ---
type AppEvents = {
  USER_UPDATED: Record<string, unknown> | null
  BALANCE_UPDATED: Record<string, unknown> | null // Payload from your Hono server broadcast
  PRESENCE_UPDATE: Record<string, unknown> | null
}
export const appEmitter = mitt<AppEvents>()

// --- 3. Define Singleton State ---
const user = shallowRef<User | null>(null)
const session = shallowRef<Session | null>(null)
const appUser = shallowRef<AppUser | null>(null)
const loading = ref(true)

let realtimeChannels: RealtimeChannel[] = []
let initialized = false

/**
 * The main authentication composable.
 */
export function useAuth() {
  const router = useRouter()

  // --- 4. Custom Fetch Client ---
  const authedFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!session.value) {
      throw new Error('No active session. Request blocked.')
    }
    const headers = new Headers(init?.headers)
    headers.set('Authorization', `Bearer ${session.value.access_token}`)
    return fetch(input, { ...init, headers })
  }

  // --- 5. Hono Server Integration ---
  const fetchAppUser = async () => {
    try {
      const response = await authedFetch('/api/auth/get-user')
      if (!response.ok) {
        throw new Error(`Failed to fetch app user: ${response.statusText}`)
      }
      appUser.value = await response.json()
    } catch (error) {
      console.error('Error in fetchAppUser:', error)
      appUser.value = null
    }
  }

  // --- 6. Realtime Setup ---
  const cleanupRealtime = async () => {
    if (realtimeChannels.length > 0) {
      await Promise.all(
        realtimeChannels.map((channel) => supabase.removeChannel(channel)),
      )
      realtimeChannels = []
    }
  }

  const setupRealtime = async (userId: string) => {
    await cleanupRealtime()

    // *** MODIFIED SECTION ***
    // Channel 1: Listen to 'user' table via Broadcast
    // (Requires a DB trigger to send this broadcast)
    const userTopic = `user:${userId}`
    const userChannel = supabase.channel(userTopic, {
      config: { private: true },
    })

    userChannel.on('broadcast', { event: 'UPDATE' }, (payload) => {
      console.log('Realtime: User UPDATE broadcast', payload)
      // Update the local appUser state directly
      appUser.value = { ...appUser.value, ...payload.payload }
      // Also emit for other components
      appEmitter.emit('USER_UPDATED', payload.payload)
    })
    // You can add .on('broadcast', { event: 'INSERT' }, ...) if needed
    // *** END MODIFIED SECTION ***

    // Channel 2: Listen to 'user_balances' via Broadcast
    const balanceTopic = `user:${userId}:balance`
    const balanceChannel = supabase.channel(balanceTopic, {
      config: { private: true },
    })

    balanceChannel.on('broadcast', { event: 'INSERT' }, (payload) => {
      console.log('Realtime: Balance INSERT broadcast', payload)
      appEmitter.emit('BALANCE_UPDATED', payload.payload)
    })
    balanceChannel.on('broadcast', { event: 'UPDATE' }, (payload) => {
      console.log('Realtime: Balance UPDATE broadcast', payload)
      appEmitter.emit('BALANCE_UPDATED', payload.payload)
    })
    balanceChannel.on('broadcast', { event: 'DELETE' }, (payload) => {
      console.log('Realtime: Balance DELETE broadcast', payload)
      appEmitter.emit('BALANCE_UPDATED', payload.payload)
    })

    // Channel 3: Listen to presence
    const presenceChannel = supabase.channel('global-presence', {
      config: {
        presence: { key: userId },
      },
    })

    presenceChannel.on('presence', { event: 'sync' }, () => {
      const state = presenceChannel.presenceState()
      console.log('Realtime: Presence sync', state)
      appEmitter.emit('PRESENCE_UPDATE', state)
    })

    // Store ALL channels for cleanup
    realtimeChannels = [userChannel, balanceChannel, presenceChannel]

    // Subscribe to all channels
    try {
      await Promise.all(
        realtimeChannels.map(
          (channel) =>
            new Promise((resolve, reject) => {
              channel.subscribe((status, err) => {
                if (status === 'SUBSCRIBED') {
                  resolve(status)
                } else if (err) {
                  console.error(
                    `Failed to subscribe to channel ${channel.topic}`,
                    err,
                  )
                  reject(err)
                } else if (status === 'CHANNEL_ERROR') {
                  console.error(`Channel error on ${channel.topic}`, err)
                  reject(new Error(err?.message || 'Channel error'))
                }
              })
            }),
        ),
      )
      console.log('All realtime channels subscribed')
      await presenceChannel.track({ online_at: new Date().toISOString() })
    } catch (error) {
      console.error('Realtime subscription failed:', error)
    }
  }

  // --- 7. Initialization Logic (Runs ONCE) ---
  if (!initialized) {
    initialized = true

    supabase.auth.onAuthStateChange(async (event, newSession) => {
      console.log('onAuthStateChange event:', event)
      session.value = newSession
      user.value = newSession?.user ?? null

      if (
        event === 'SIGNED_IN' ||
        event === 'INITIAL_SESSION' ||
        event === 'TOKEN_REFRESHED'
      ) {
        if (newSession) {
          await fetchAppUser()
          await setupRealtime(newSession.user.id)
        }
      } else if (event === 'SIGNED_OUT') {
        await cleanupRealtime()
        appUser.value = null
        router.push('/login')
      }

      loading.value = false
    })
  }

  // --- 8. Return ---
  return {
    user: readonly(user),
    session: readonly(session),
    appUser: readonly(appUser),
    loading: readonly(loading),
    authedFetch,
    supabase,
  }
}
