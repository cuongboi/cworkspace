# Build stage: SPA → apps/api/src/public, then bun --compile → /src/run-server
FROM oven/bun:1.4.3 AS build
WORKDIR /src
COPY . .
RUN bun install --frozen-lockfile && bun run build

# Distroless runtime: only the compiled binary. base-debian12 (not static) because
# the bun-compiled binary links glibc; it already ships CA certs and a nonroot user.
FROM gcr.io/distroless/base-debian12:nonroot
WORKDIR /app
COPY --from=build --chown=nonroot:nonroot --chmod=755 /src/run-server /app/server
USER nonroot
EXPOSE 3000
ENV NODE_ENV=production
CMD ["/app/server", "--host", "0.0.0.0", "--port", "3000"]
