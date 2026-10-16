# Kino2026

## Docker

The updater is a one-shot job, not a web server. It uses Playwright to fetch the
latest draw and updates `kino-history.json` and `kino-history.xml` on the host.

Build the image and run an update:

```sh
docker compose build
docker compose run --rm kino-update
```

Run the same command from a host scheduler (such as cron or Windows Task
Scheduler) to update the history periodically. The Compose service mounts both
history files from the project directory so updates persist between runs.

To run another project script in the container, override the command. For
example, to regenerate the frequency chart:

```sh
docker compose run --rm kino-update npm run analyze
```
