<script setup lang="ts">
import { ref } from "vue";
import type { AuthFormField, FormSubmitEvent } from "@nuxt/ui";
import { useToast } from "@nuxt/ui/runtime/composables/useToast.js";
import * as z from "zod";
import { supabase } from "../composables/useAuth";
// import { useUserStore } from "../stores/user";

const toast = useToast();
const register = ref(false);
const logoImage = ref<HTMLImageElement | null>(null);

// Diagnostic function to log image dimensions and positioning
const logImageDimensions = () => {
  if (logoImage.value) {
    console.log("Logo image dimensions:", {
      width: logoImage.value.offsetWidth,
      height: logoImage.value.offsetHeight,
      top: logoImage.value.offsetTop,
      left: logoImage.value.offsetLeft,
      src: logoImage.value.src,
    });

    // Log viewport dimensions for responsiveness context
    console.log("Viewport dimensions:", {
      width: window.innerWidth,
      height: window.innerHeight,
    });

    // Log form card position relative to image
    const formCard = document.querySelector(".max-w-sm") as HTMLElement;
    if (formCard) {
      console.log("Form card position:", {
        top: formCard.offsetTop,
        height: formCard.offsetHeight,
        intersectsImage:
          formCard.offsetTop <
          logoImage.value.offsetTop + logoImage.value.offsetHeight / 2,
      });
    }
  }
};

const fields: AuthFormField[] = [
  {
    name: "username",
    type: "text",
    label: "username",
    placeholder: "Enter your username",
    required: true,
  },
  {
    name: "password",
    label: "Password",
    type: "password",
    placeholder: "Enter your password",
    required: true,
  },
  {
    name: "remember",
    label: "Remember me",
    type: "checkbox",
  },
];
const rfields: AuthFormField[] = [
  {
    name: "username",
    type: "text",
    label: "username",
    placeholder: "Enter your username",
    required: true,
  },
  {
    name: "password",
    label: "Password",
    type: "password",
    placeholder: "Enter your password",
    required: true,
  },
  {
    name: "cpassword",
    label: "",
    type: "password",
    placeholder: "Confirm your password",
    required: true,
  },
  {
    name: "remember",
    label: "Remember me",
    type: "checkbox",
  },
];
const providers = [
  {
    label: "Google",
    icon: "i-simple-icons-google",
    onClick: () => {
      toast.add({ title: "Google", description: "Login with Google" });
    },
  },
  {
    label: "GitHub",
    icon: "i-simple-icons-github",
    onClick: () => {
      toast.add({ title: "GitHub", description: "Login with GitHub" });
    },
  },
];

const schema = z.object({
  username: z.string(),
  password: z.string().min(8, "Must be at least 8 characters"),
});

type Schema = z.output<typeof schema>;
const rschema = z.object({
  username: z.string(),
  password: z.string().min(8, "Must be at least 8 characters"),
  cpassword: z.string().min(8, "Must be at least 8 characters"),
});

type RSchema = z.output<typeof rschema>;
async function onSubmit(payload: FormSubmitEvent<Schema>) {
  console.log("click");
  // const userStore = useUserStore();

  // This is correct! It uses the client SDK.
  const { error } = await supabase.auth.signInWithPassword({
    email: `${payload.data.username}@cashflowcasino.com`,
    password: payload.data.password,
  });

  if (error) {
    const errorData = await error; //.json().catch(() => ({}))
    toast.add({
      title: "Error",
      description: errorData.message || `Login failed: ${error.statusText}`,
      color: "red",
    });
    console.error("Login Error:", errorData.message);
    // throw new Error(errorData.message || `Login failed: ${error.statusText}`);
  }

  // No need to do anything else.
  // onAuthStateChange in useAuth.ts will handle the successful login.
}

async function onRSubmit(payload: FormSubmitEvent<RSchema>) {
  console.log("click");

  if (payload.data.password !== payload.data.cpassword) {
    toast.add({
      title: "Error",
      description: "Passwords do not match",
      color: "red",
    });
    return;
  }

  // *** THIS IS THE FIX ***
  // Use the client-side SDK for sign-up, just like you do for sign-in.
  const { data, error } = await supabase.auth.signUp({
    email: `${payload.data.username}@cashflowcasino.com`,
    password: payload.data.password,
    options: {
      data: {
        username: payload.data.username,
        // Add other metadata if needed
      },
    },
  });

  if (error) {
    const errorData = await error;
    toast.add({
      title: "Error",
      description: errorData.message || `Sign-up failed: ${error.statusText}`,
      color: "red",
    });
    console.error("Sign-up Error:", errorData.message);
    // throw new Error(errorData.message || `Sign-up failed: ${error.statusText}`);
  }

  // On successful sign-up, onAuthStateChange will fire with a SIGNED_IN event.
  // If you have email confirmation enabled, the user will be signed in,
  // but you may want to check for data.user.email_confirmed_at.
  console.log("Sign-up success:", data.user);
}
</script>

<template>
  <div class="h-screen flex relative px-4 mt-22">
    <!-- Floating logo image positioned for intersection -->
    <img
      height="80px"
      width="150px"
      src="/logo.png"
      class="absolute top-20 left-1/2 transform -translate-x-1/2 z-10"
      @load="logImageDimensions"
      ref="logoImage"
    />

    <!-- Form container positioned to intersect with image -->
    <div class="absolute top-32 left-1/2 transform -translate-x-1/2">
      <UPageCard variant="subtle" class="w-full">
        <div v-if="!register" class="p-4 px-8">
          <!-- Image removed from here, now floating above -->
          <UAuthForm
            :fields="fields"
            :schema="schema"
            :providers="providers"
            @submit="onSubmit"
            class="pt-12"
          >
            <template #description>
              Don't have an account?
              <ULink
                to="/signup"
                class="text-primary font-medium"
                @click="register = true"
                >Sign up</ULink
              >.
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
        </div>
        <div v-else class="p-4 px-8">
          <UAuthForm
            :fields="rfields"
            :schema="rschema"
            :providers="providers"
            @submit="onRSubmit"
            class="pt-8"
          >
            <template #description>
              Already have an account?
              <ULink
                to="/signup"
                class="text-primary font-medium"
                @click="register = false"
                >Sign in</ULink
              >.
            </template>

            <template #footer>
              By signing in, you agree to our
              <ULink to="/" class="text-primary font-medium"
                >Terms of Service </ULink
              >.
            </template>
          </UAuthForm>
        </div>
      </UPageCard>
    </div>
  </div>
</template>
