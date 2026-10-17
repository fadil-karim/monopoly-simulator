# The simulator in a container: the engine, the AI players, the runner and its dashboard, apart from the site. The
# games, the table and the keys live in /data, a volume that outlasts every rebuild and update of the image, so the
# site can be updated on its own and the simulator updated without touching the record of the games played. The
# dashboard also serves the site's pages read from that store, which is why the image carries public/ and the
# statistics code; nothing of the site's Worker or database is in it.
#
#   docker compose up -d --build                         the dashboard, at http://127.0.0.1:8788/ on this machine
#   MONOPOLY_MODE=play docker compose up -d --build      no dashboard: batch after batch, the keys from simulator.env
#   MONOPOLY_MODE=cpu docker compose up -d --build       no dashboard: the eight CPU players, kept in the store
#
# The modes are in runner/docker-entrypoint.sh; the README's "Running the simulator in Docker" has the rest.
FROM node:22-alpine

ENV NODE_ENV=production \
    MONOPOLY_DATA=/data \
    MONOPOLY_CONTAINER=1 \
    DASHBOARD_HOST=0.0.0.0 \
    DASHBOARD_PORT=8788

WORKDIR /app
# Nothing to install: the simulator is plain Node with no dependencies, and the site's Wrangler stays out of the image.
# package.json is copied for its "type": "module", which makes the shared modules ES modules.
COPY package.json ./
COPY public/ public/
COPY src/aggregate.js src/aggregate.js
COPY runner/ runner/
RUN mkdir -p /data && chown node:node /data

USER node
VOLUME ["/data"]
EXPOSE 8788
ENTRYPOINT ["/bin/sh", "runner/docker-entrypoint.sh"]
CMD ["dashboard"]
