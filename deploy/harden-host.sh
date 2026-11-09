#!/bin/sh
set -eu
# Run only on a new, dedicated Ubuntu 24.04 host after testing a second key-only SSH session.
[ "$(id -u)" = 0 ] || { echo 'Run as root on the dedicated host.' >&2; exit 1; }
[ "${NUQTA_HARDEN_CONFIRMED:-}" = key-login-tested ] || {
  echo 'Test a second SSH key session, then set NUQTA_HARDEN_CONFIRMED=key-login-tested.' >&2
  exit 1
}
. /etc/os-release
[ "$ID" = ubuntu ] && [ "$VERSION_ID" = 24.04 ] || { echo 'Ubuntu 24.04 required.' >&2; exit 1; }
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ufw fail2ban unattended-upgrades
install -m 600 /dev/null /etc/ssh/sshd_config.d/00-nuqta.conf
cat > /etc/ssh/sshd_config.d/00-nuqta.conf <<'EOF'
PermitRootLogin prohibit-password
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
EOF
sshd -t
sshd -T | grep -q '^passwordauthentication no$'
sshd -T | grep -q '^kbdinteractiveauthentication no$'
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable
cat > /etc/fail2ban/jail.d/nuqta.local <<'EOF'
[sshd]
enabled = true
backend = systemd
maxretry = 5
bantime = 3600
EOF
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
systemctl enable --now fail2ban
systemctl reload ssh
echo 'Review ufw status and sshd -T. Docker published ports bypass ufw: publish only Caddy 80/443.'
