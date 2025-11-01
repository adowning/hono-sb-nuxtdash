import { hc } from "hono/client";
import { type AppType } from "@backend/src/app"; // Assumes this path is correct
import { useAuth } from "./useAuth";

/**
 * A composable that returns a type-safe Hono RPC client (`hc`)
 * pre-configured to handle Supabase authentication.
 */
export function useApi() {
  // Get the reactive session ref from our auth composable
  const { session } = useAuth();

  /**
   * This is a custom fetch wrapper that intercepts every
   * request made by the Hono client.
   */
  const customFetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    // Get the *current* session value.
    const currentSession = session.value;

    // Block the request if the user is not logged in.
    if (!currentSession?.access_token) {
      console.error("useApi: No active session. Request blocked.");
      // Throwing an error stops the request and rejects the promise.
      throw new Error("No active session. Request blocked.");
    }

    // Create new headers, preserving any existing ones
    const headers = new Headers(init?.headers);

    // Add the Supabase Authorization token to the request
    headers.set("Authorization", `Bearer ${currentSession.access_token}`);

    // Make the actual fetch request with the modified headers
    return fetch(input, { ...init, headers });
  };

  // Create and return the Hono client instance.
  // We assume your Hono app is served from the '/api' path.
  // Change '/api' if your backend is at a different URL.
  const api = hc<AppType>("/api", {
    fetch: customFetch, // Use our custom, auth-aware fetch wrapper
  });

  return api;
}
