# Deployment quick path

```sh
cp deploy/.env.example deploy/.env      # generate secrets locally (see comments); never commit
docker compose --env-file deploy/.env up --build
# API http://127.0.0.1:4000 · Platform http://127.0.0.1:8080
node tools/docker-smoke.mjs             # builds, starts and checks the whole stack
```

Images: `deploy/docker/Dockerfile.node` (`APP=api` or `APP=worker`; multi-stage, production
dependencies only, non-root) and `deploy/docker/Dockerfile.platform` (static build on
unprivileged nginx with a same-origin management proxy). No `.env`, keys or credentials are
baked in; `.dockerignore` excludes them.

Sequencing per release: build images, run `node dist/migrate.js` (the `migrate` service) once,
then roll the API and workers. `/ready` stays 503 until migrations match the code. Details:
[docs/production/DEPLOYMENT.md](../production/DEPLOYMENT.md).
