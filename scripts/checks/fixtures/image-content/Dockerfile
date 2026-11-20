# A fixture image the image-content check must refuse (scripts/checks/image-content.mjs): one
# harmless placeholder copied to forbidden places — an environment file other than the example, a
# private note and a seed other than the fictional demo — beside the allowed example and demo seed.
# Built and checked by the production stack's smoke check; nothing in it is a real value.
FROM scratch
COPY placeholder.txt /app/.env.example
COPY placeholder.txt /app/packages/db/seed/demo/person.json
COPY placeholder.txt /app/.env.local
COPY placeholder.txt /app/.context/notes.md
COPY placeholder.txt /app/packages/db/seed/owner/person.json
# The check only creates a container, never starts one; Docker still needs a command to create it.
CMD ["/app/never-run"]
