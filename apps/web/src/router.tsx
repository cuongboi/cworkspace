import type { ComponentType } from "react"
import { NuqsAdapter } from "nuqs/adapters/react-router/v7"
import { createBrowserRouter, Navigate, Outlet } from "react-router-dom"

import { GuestOnly, RequireAuth } from "@/components/auth-guard"
import {
  OrgLayout,
  type OrgLayoutOptions,
} from "@/components/layout/org-layout"
import { AuthLayout } from "@/pages/auth/auth-layout"
import RootRedirect from "@/pages/root-redirect"

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

/** Shell options per page, read by `OrgLayout` from the matched route's `handle`. */
const rail: OrgLayoutOptions = { rail: true }
const bleed: OrgLayoutOptions = { bleed: true }

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    // Rendered while the first lazy page chunk loads (pages are tiny; a blank frame is fine).
    HydrateFallback: () => null,
    children: [
      {
        element: <RequireAuth />,
        children: [
          { index: true, element: <RootRedirect /> },
          {
            path: "onboarding",
            lazy: page(() => import("@/pages/onboarding")),
          },
          // the tenant: everything under /:orgSlug is scoped to one organization
          {
            path: ":orgSlug",
            element: <OrgLayout />,
            children: [
              {
                index: true,
                lazy: page(() => import("@/pages/org/index")),
                handle: rail,
              },
              {
                path: "groups",
                lazy: page(() => import("@/pages/org/groups/index")),
              },
              {
                path: "groups/:groupSlug",
                lazy: page(() => import("@/pages/org/groups/group")),
              },
              {
                path: "posts/:postId",
                lazy: page(() => import("@/pages/org/posts/post")),
                handle: rail,
              },
              {
                path: "people",
                lazy: page(() => import("@/pages/org/people/index")),
              },
              {
                path: "people/:userId",
                lazy: page(() => import("@/pages/org/people/person")),
                handle: rail,
              },
              {
                path: "search",
                lazy: page(() => import("@/pages/org/search")),
                handle: rail,
              },
              {
                path: "chat",
                lazy: page(() => import("@/pages/org/chat/index")),
                handle: bleed,
              },
              {
                path: "chat/:conversationId",
                lazy: page(() => import("@/pages/org/chat/conversation")),
                handle: bleed,
              },
              {
                path: "call/:callId",
                lazy: page(() => import("@/pages/org/call/call")),
                handle: bleed,
              },
              {
                path: "calendar",
                lazy: page(() => import("@/pages/org/calendar")),
                handle: bleed,
              },
              {
                path: "notifications",
                lazy: page(() => import("@/pages/org/notifications")),
              },
              {
                path: "settings",
                lazy: page(() => import("@/pages/org/settings/index")),
              },
              {
                path: "*",
                element: <Navigate to=".." relative="path" replace />,
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
