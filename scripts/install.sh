#!/usr/bin/env bash
# NOVA fresh-server installer. Read docs/INSTALL.md before running as root.
set -Eeuo pipefail
umask 077
release=installer-v1.0.0
destination=/opt/nova
domain=''
resume=0
usage() {
  echo 'NOVA: sudo bash install.sh --domain shop.example.ru'
  echo 'After an interrupted install: sudo bash install.sh --resume'
}
die() { echo "NOVA: $*" >&2; exit 1; }
while (($#)); do
  case "$1" in
    --domain) (($# >= 2)) || die 'Missing domain'; domain=$2; shift 2 ;;
    --resume) resume=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) die "Unknown option: $1" ;;
  esac
done
if ((resume)); then
  [[ -z "$domain" ]] || die '--resume cannot change the domain'
else
  [[ ${#domain} -le 253 && "$domain" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,63}|xn--[a-z0-9-]{2,59})$ ]] || die 'Use a lowercase DNS domain, without https://, paths or ports (IDN: punycode)'
fi
[[ $EUID == 0 ]] || die 'Run using sudo or as root'
[[ -f /etc/os-release ]] || die 'Supported systems: Ubuntu 22.04/24.04, Debian 12/13'
# Standard OS metadata, not application configuration.
. /etc/os-release
case "$ID:$VERSION_ID" in
  ubuntu:22.04|ubuntu:24.04|debian:12|debian:13) ;;
  *) die 'Supported systems: Ubuntu 22.04/24.04, Debian 12/13' ;;
esac
for tool in curl tar python3 ss openssl; do command -v "$tool" >/dev/null || die "Install prerequisite: $tool"; done
if ((!resume)); then
  [[ ! -e "$destination" && ! -L "$destination" ]] || die '/opt/nova already exists; this installer never overwrites an installation'
  [[ -z "$(ss -H -ltn '( sport = :80 or sport = :443 )')" ]] || die 'Ports 80/443 are occupied. Use a fresh server; existing web servers will not be stopped'
  python3 - "$domain" <<'PY'
import socket, sys
socket.getaddrinfo(sys.argv[1], 443, type=socket.SOCK_STREAM)
PY
  memory=$(awk '/MemTotal:/ {print $2}' /proc/meminfo)
  ((memory >= 1500000)) || die 'At least 2 GB RAM is recommended for building; this machine has less than 1.5 GB'
  free_kb=$(df -Pk /opt | awk 'NR==2 {print $4}')
  ((free_kb >= 4194304)) || die 'At least 4 GB free disk space is required'
else
  [[ -f "$destination/.nova-install" && -f "$destination/.env" && -f "$destination/deploy/docker/compose.yaml" ]] || die 'No interrupted NOVA installation in /opt/nova'
fi
scratch=$(mktemp -d)
cleanup() { rm -rf -- "$scratch"; }
trap cleanup EXIT
trap 'echo "NOVA installation did not finish. Data and secrets are retained in /opt/nova; see docs/INSTALL.md. No existing site was stopped." >&2' ERR
if ! command -v docker >/dev/null; then
  ((resume == 0)) || die 'Docker is missing; restore Docker before resuming'
  # Refuse conflicting packages instead of uninstalling software from this host.
  for package in docker.io docker-compose docker-compose-v2 podman-docker containerd runc; do
    if dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -q 'install ok installed'; then
      die "Conflicting package $package is installed. Prepare Docker using its official instructions first"
    fi
  done
  [[ ! -e /etc/apt/sources.list.d/docker.sources && ! -e /etc/apt/keyrings/docker.asc ]] || die 'Existing Docker repository configuration; install Docker manually first'
  apt-get update
  apt-get install -y ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl --fail --location --proto '=https' --tlsv1.2 --max-time 60 "https://download.docker.com/linux/$ID/gpg" -o /etc/apt/keyrings/docker.asc
  chmod 644 /etc/apt/keyrings/docker.asc
  cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/$ID
Suites: $VERSION_CODENAME
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
fi
docker info >/dev/null 2>&1 || die 'Docker daemon is unavailable'
docker compose version >/dev/null || die 'Docker Compose plugin is required'
if ((!resume)); then
  [[ -z "$(docker ps -aq --filter label=com.docker.compose.project=nova)" && -z "$(docker volume ls -q --filter label=com.docker.compose.project=nova)" ]] || die 'Docker project nova already exists; refusing to reuse its data'
  curl --fail --location --proto '=https' --tlsv1.2 --retry 2 --max-time 120 "https://codeload.github.com/maxx52/nova-engine/tar.gz/refs/heads/$release" -o "$scratch/source.tar.gz"
  mkdir "$scratch/source"
  tar --no-same-owner --no-same-permissions -xzf "$scratch/source.tar.gz" --strip-components=1 -C "$scratch/source"
  [[ -f "$scratch/source/deploy/docker/compose.yaml" ]] || die 'Release archive does not contain Docker deployment files'
  install -m 700 -d "$destination"
  cp -a "$scratch/source/." "$destination/"
  db_root=$(openssl rand -hex 32)
  db_app=$(openssl rand -hex 32)
  setup_key=$(openssl rand -hex 32)
  printf 'NOVA_DOMAIN=%s\nPOSTGRES_PASSWORD=%s\nNOVA_DB_PASSWORD=%s\nADMIN_API_KEY=%s\n' "$domain" "$db_root" "$db_app" "$setup_key" > "$destination/.env"
  printf '%s\n' "$setup_key" > "$destination/setup-key"
  printf '%s\n' "$release" > "$destination/.nova-install"
  chmod 600 "$destination/.env" "$destination/setup-key"
  unset db_root db_app setup_key
fi
cd "$destination"
domain=$(sed -n 's/^NOVA_DOMAIN=//p' .env)
[[ "$domain" =~ ^[a-z0-9.-]+$ ]] || die 'Invalid domain in retained .env'
compose=(docker compose --env-file "$destination/.env" -f "$destination/deploy/docker/compose.yaml")
"${compose[@]}" config --quiet
"${compose[@]}" up -d --build --wait --wait-timeout 240
echo 'Waiting for HTTPS certificate (DNS and ports 80/443 must point to this server)...'
https_ready=0
for ((attempt=0; attempt<30; attempt++)); do
  if curl --fail --silent --show-error --max-time 5 "https://$domain/api/auth/status" -o "$scratch/status.json" 2>/dev/null && python3 - "$scratch/status.json" <<'PY'
import json, sys
assert isinstance(json.load(open(sys.argv[1])).get('setup_required'), bool)
PY
  then https_ready=1; break; fi
  sleep 3
done
((https_ready)) || die 'HTTPS is not ready. Check DNS A/AAAA, firewall and Caddy logs; then rerun with --resume. Do not delete volumes'
printf '\nNOVA is ready: https://%s/\nAdmin: https://%s/admin/\n' "$domain" "$domain"
echo 'Create your administrator in the browser. Read the one-time setup key locally using: sudo cat /opt/nova/setup-key'
echo 'Secrets: /opt/nova/.env (root only). Instructions: /opt/nova/docs/INSTALL.md'
