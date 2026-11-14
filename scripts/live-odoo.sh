#!/usr/bin/env bash
# Start or stop the disposable Odoo the live gate reads.
#
#   scripts/live-odoo.sh up 19|20   initialise okf_live with base and sale,
#                                   create the API keys, start the server and
#                                   print KEY=value lines on stdout
#   scripts/live-odoo.sh down       remove the containers and volumes
#
# Progress goes to stderr, so `scripts/live-odoo.sh up 19 >> "$GITHUB_ENV"`
# exports the keys. The compose project is okf-odoo-live; Odoo 19 listens on
# 127.0.0.1:18069 and Odoo 20 on 127.0.0.1:18070.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
compose_file="${here}/../test/live/compose.yml"
project="okf-odoo-live"

compose() {
  docker compose -p "${project}" -f "${compose_file}" "$@"
}

case "${1:-}" in
  up)
    version="${2:-}"
    case "${version}" in
      19) port=18069 ;;
      20) port=18070 ;;
      *) echo "usage: $0 up 19|20" >&2; exit 2 ;;
    esac
    export OKF_ODOO_IMAGE="odoo:${version}.0"
    export OKF_ODOO_PORT="${port}"

    compose up -d --wait db >&2
    echo "Initialising okf_live on ${OKF_ODOO_IMAGE} with base and sale" >&2
    compose run --rm -T odoo odoo -d okf_live -i base,sale --stop-after-init \
      --max-cron-threads=0 >&2

    # Two keys: one for a dedicated Settings administrator, which the full
    # catalog needs, and one for a user who only manages access rights, which
    # proves that a section it cannot read fails instead of shrinking.
    keys="$(compose run --rm -T odoo odoo shell -d okf_live --no-http <<'PY'
Users = env["res.users"].with_context(no_reset_password=True)
groups_field = "group_ids" if "group_ids" in Users._fields else "groups_id"

def technical_user(login, xmlids):
    user = Users.search([("login", "=", login)])
    if not user:
        user = Users.create({"name": login, "login": login})
    user.write({groups_field: [(6, 0, [env.ref(xmlid).id for xmlid in xmlids])]})
    return user

reader = technical_user("okf-reader", ["base.group_user", "base.group_system"])
manager = technical_user("okf-access-manager", ["base.group_user", "base.group_erp_manager"])
Keys = env["res.users.apikeys"]
print("OKF_ODOO_API_KEY=" + Keys.with_user(reader)._generate("rpc", "okf-odoo-live", None))
# Only a Settings administrator may hold a key without expiry; sudo lets the
# script issue one to the limited user for the duration of the gate.
print("OKF_ODOO_LIMITED_API_KEY=" + Keys.with_user(manager).sudo()._generate("rpc", "okf-odoo-live", None))
env.cr.commit()
PY
)"

    compose up -d odoo >&2
    echo "Waiting for http://127.0.0.1:${port}" >&2
    for _ in $(seq 1 120); do
      if curl -fsS -o /dev/null "http://127.0.0.1:${port}/web/login"; then
        break
      fi
      sleep 1
    done
    curl -fsS -o /dev/null "http://127.0.0.1:${port}/web/login"
    echo "OKF_ODOO_URL=http://127.0.0.1:${port}"
    echo "OKF_ODOO_DATABASE=okf_live"
    echo "OKF_ODOO_VERSION=${version}"
    printf '%s\n' "${keys}" | grep -E '^OKF_ODOO_(LIMITED_)?API_KEY=[0-9A-Za-z_]+$'
    ;;
  down)
    compose down -v >&2
    ;;
  *)
    echo "usage: $0 up 19|20 | down" >&2
    exit 2
    ;;
esac
