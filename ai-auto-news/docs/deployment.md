# Deployment

This repo supports multiple ways to run `ai-auto-news`. The most reliable path is local development with `npm run dev`.

## Docker Compose (single container + SQLite volume)

From `ai-auto-news/`:

```bash
docker compose up --build
```

- The container exposes port `3000`.
- SQLite persists to a Docker volume mounted at `/app/data`.

## Kubernetes manifests (starting point)

The repo contains Kubernetes manifests under `ai-auto-news/k8s/`.

These are a **starting point** and should be reviewed before any production use (secrets, TLS, resource sizing, database setup, operational concerns).

## Terraform (starting point)

The repo contains Terraform configuration under `ai-auto-news/terraform/main.tf`.

Treat it as a **starting point** and review carefully before running against a real cloud account.

