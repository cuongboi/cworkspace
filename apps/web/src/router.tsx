import type { ComponentType } from "react"
import { NuqsAdapter } from "nuqs/adapters/react-router/v7"
import { createBrowserRouter, Navigate, Outlet } from "react-router-dom"

import { GuestOnly, RequireAuth } from "@/components/auth-guard"
import {
  AppLayout,
  type AppLayoutOptions,
} from "@/components/layout/app-layout"
import { AuthLayout } from "@/pages/auth/auth-layout"

/**
 * Route-level code splitting: each page loads on first visit, so the entry
 * chunk only carries the shell (layouts, guards, providers).
 */
function page<M extends Record<string, unknown>>(
  load: () => Promise<M>,
  name: keyof M = "default"
) {
  return async () => ({ Component: (await load())[name] as ComponentType })
}

/** nuqs reads/writes the URL through the router, so it must sit inside it. */
function RootLayout() {
  return (
    <NuqsAdapter>
      <Outlet />
    </NuqsAdapter>
  )
}

/** Shell options per page, read by `AppLayout` from the matched route's `handle`. */
const rail: AppLayoutOptions = { rail: true }
const bleed: AppLayoutOptions = { bleed: true }

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    // Rendered while the first lazy page chunk loads (pages are tiny; a blank frame is fine).
    HydrateFallback: () => null,
    children: [
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AppLayout />,
            children: [
              {
                index: true,
                lazy: page(() => import("@/pages/app/index")),
                handle: rail,
              },
              {
                // groups sidebar | group overview, channel chat or discover
                path: "groups",
                lazy: page(() => import("@/pages/app/groups/layout")),
                handle: bleed,
                children: [
                  {
                    index: true,
                    lazy: page(() => import("@/pages/app/groups/home")),
                  },
                  {
                    path: "discover",
                    lazy: page(() => import("@/pages/app/groups/index")),
                  },
                  {
                    path: ":groupSlug",
                    lazy: page(() => import("@/pages/app/groups/group")),
                  },
                  {
                    path: ":groupSlug/wiki/:pageId?",
                    lazy: page(() => import("@/pages/app/groups/wiki")),
                  },
                  {
                    path: ":groupSlug/c/:channelId",
                    lazy: page(() => import("@/pages/app/groups/channel")),
                  },
                ],
              },
              {
                path: "posts/:postId",
                lazy: page(() => import("@/pages/app/posts/post")),
                handle: rail,
              },
              {
                path: "people",
                lazy: page(() => import("@/pages/app/people/index")),
              },
              {
                path: "people/:userId",
                lazy: page(() => import("@/pages/app/people/person")),
                handle: rail,
              },
              {
                path: "search",
                lazy: page(() => import("@/pages/app/search")),
                handle: rail,
              },
              {
                path: "chat",
                lazy: page(() => import("@/pages/app/chat/index")),
                handle: bleed,
              },
              {
                path: "chat/:conversationId",
                lazy: page(() => import("@/pages/app/chat/conversation")),
                handle: bleed,
              },
              {
                path: "call/:callId",
                lazy: page(() => import("@/pages/app/call/call")),
                handle: bleed,
              },
              {
                path: "calendar",
                lazy: page(() => import("@/pages/app/calendar")),
                handle: bleed,
              },
              {
                path: "notifications",
                lazy: page(() => import("@/pages/app/notifications")),
              },
              {
                path: "settings",
                lazy: page(() => import("@/pages/app/settings/index")),
              },
              {
                path: "account",
                lazy: page(() => import("@/pages/app/account/index")),
              },
            ],
          },
        ],
      },
      {
        element: <GuestOnly />,
        children: [
          {
            element: <AuthLayout />,
            children: [
              {
                path: "sign-in",
                lazy: page(() => import("@/pages/auth/sign-in"), "SignInPage"),
              },
              {
                path: "sign-up",
                lazy: page(() => import("@/pages/auth/sign-up"), "SignUpPage"),
              },
              {
                path: "forgot-password",
                lazy: page(
                  () => import("@/pages/auth/forgot-password"),
                  "ForgotPasswordPage"
                ),
              },
            ],
          },
        ],
      },
      // First run only (the page itself checks the server and the setup token).
      { path: "onboarding", lazy: page(() => import("@/pages/onboarding")) },
      // Reachable whether or not a session exists (the links come from emails).
      { path: "invite/:id", lazy: page(() => import("@/pages/invite")) },
      {
        element: <AuthLayout />,
        children: [
          {
            path: "reset-password",
            lazy: page(
              () => import("@/pages/auth/reset-password"),
              "ResetPasswordPage"
            ),
          },
        ],
      },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
])
