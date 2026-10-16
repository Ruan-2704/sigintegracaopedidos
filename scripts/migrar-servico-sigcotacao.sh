#!/usr/bin/env bash
# Executar no servidor da API: sudo bash migrar-servico-sigcotacao.sh
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo 'Execute com sudo bash.'; exit 1; }
old=sig-cotefacil.service
new=sigcotacao.service
old_path=/etc/systemd/system/$old
new_path=/etc/systemd/system/$new
[ -f "$old_path" ] || { echo "Servico de origem ausente: $old_path"; exit 1; }
[ ! -e "$new_path" ] && [ ! -e "$new_path.d" ] || { echo 'Destino ja existe. Nenhuma alteracao feita.'; exit 1; }
id sigpedidos >/dev/null
command -v visudo >/dev/null
[ -x /usr/bin/systemctl ]
backup=/var/backups/sigcotacao/$(date +%Y%m%d-%H%M%S)
mkdir -p "$backup"
cp -a "$old_path" "$backup/"
if [ -d "$old_path.d" ]; then cp -a "$old_path.d" "$backup/"; fi
permission=/etc/sudoers.d/sigcotacao-painel
if [ -e "$permission" ]; then cp -a "$permission" "$backup/sudoers-anterior"; fi
printf '%s\n' 'sigpedidos ALL=(root) NOPASSWD: /usr/bin/systemctl start sigcotacao.service, /usr/bin/systemctl stop sigcotacao.service' > "$backup/sudoers-novo"
chmod 440 "$backup/sudoers-novo"
visudo -cf "$backup/sudoers-novo"
was_active=false
if systemctl is-active --quiet "$old"; then was_active=true; fi
cp -a "$old_path" "$new_path"
if [ -d "$old_path.d" ]; then cp -a "$old_path.d" "$new_path.d"; fi
systemctl disable --now "$old"
mv "$old_path" "$backup/origem.service"
if [ -d "$old_path.d" ]; then mv "$old_path.d" "$backup/origem.service.d"; fi
install -o root -g root -m 440 "$backup/sudoers-novo" "$permission"
visudo -cf /etc/sudoers
systemctl daemon-reload
systemctl enable "$new"
if "$was_active"; then systemctl start "$new"; fi
systemctl show "$new" --no-pager -p LoadState -p ActiveState -p ExecStart -p Restart
sudo -u sigpedidos sudo -n -l /usr/bin/systemctl start sigcotacao.service
sudo -u sigpedidos sudo -n -l /usr/bin/systemctl stop sigcotacao.service
printf 'Migracao concluida. Backup: %s\n' "$backup"
echo 'Mantido o estado anterior: se estava parada, use o painel para iniciar.'
