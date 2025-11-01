<script setup lang="ts">
  import type { AuthFormField, FormSubmitEvent } from '@nuxt/ui'
  import { useToast } from '@nuxt/ui/runtime/composables/useToast.js'
  import * as z from 'zod'
  // import { useUserStore } from '../stores/user'
  import { supabase } from '../client/supabase'

  const toast = useToast()

  const fields: AuthFormField[] = [
    {
      name: 'username',
      type: 'text',
      label: 'username',
      placeholder: 'Enter your username',
      required: true,
    },
    {
      name: 'password',
      label: 'Password',
      type: 'password',
      placeholder: 'Enter your password',
      required: true,
    },
    {
      name: 'remember',
      label: 'Remember me',
      type: 'checkbox',
    },
  ]

  const providers = [
    {
      label: 'Google',
      icon: 'i-simple-icons-google',
      onClick: () => {
        toast.add({ title: 'Google', description: 'Login with Google' })
      },
    },
    {
      label: 'GitHub',
      icon: 'i-simple-icons-github',
      onClick: () => {
        toast.add({ title: 'GitHub', description: 'Login with GitHub' })
      },
    },
  ]

  const schema = z.object({
    username: z.string(),
    password: z.string().min(8, 'Must be at least 8 characters'),
  })

  type Schema = z.output<typeof schema>

  async function onSubmit(payload: FormSubmitEvent<Schema>) {
    console.log('click')
    // const userStore = useUserStore()
    // const response = await fetch('/api/auth/sign-in/username', {
    //   method: 'POST',
    //   headers: {
    //     'Content-Type': 'application/json',
    //   },
    //   credentials: 'include', // Include cookies
    //   body: JSON.stringify({
    //     username: payload.data.username,
    //     password: payload.data.password,
    //   }),
    // })
    const { error } = await supabase.auth.signInWithPassword({
      email: `${payload.data.username}@cashflowcasino.com`,
      password: payload.data.password,
    })
    if (error) {
      const errorData = await error //.json().catch(() => ({}))
      throw new Error(errorData.message || `Login failed: ${error.statusText}`)
    }

    // const userData = await error.json()
    // console.log(userData)
    // userStore.setCurrentUser(userData.user);
    // userStore.user = userData.user
    // userStore.token = userData.accessToken
  }
</script>

<template>
  <div class="h-screen flex items-center justify-center px-4">
    <!-- <UButton icon="i-lucide-chevron-left" to="/" size="xl" color="neutral" variant="subtle"
            class="absolute left-8 top-8 rounded-full z-10" /> -->

    <UPageCard variant="subtle" class="max-w-sm w-full">
      <UAuthForm
        :fields="fields"
        :schema="schema"
        :providers="providers"
        title="Welcome back"
        icon="i-lucide-lock"
        @submit="onSubmit"
      >
        <template #description>
          Don't have an account?
          <ULink to="/signup" class="text-primary font-medium">Sign up</ULink>.
        </template>

        <template #password-hint>
          <ULink to="/" class="text-primary font-medium" tabindex="-1"
            >Forgot password?</ULink
          >
        </template>

        <template #footer>
          By signing in, you agree to our
          <ULink to="/" class="text-primary font-medium"
            >Terms of Service </ULink
          >.
        </template>
      </UAuthForm>
    </UPageCard>
  </div>
</template>
