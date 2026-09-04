#!/bin/bash

set -euo pipefail

# ─── Colors (maps to portal theme: warm foreground, terracotta accent) ────────
if [ -t 1 ]; then
    BOLD="\033[1m"
    DIM="\033[2m"
    ORANGE="\033[38;5;166m"   # terracotta accent  ≈ #c2410c
    MUTED="\033[38;5;245m"   # muted text         ≈ #686259
    GREEN="\033[38;5;71m"    # success
    YELLOW="\033[38;5;179m"  # warning
    RED="\033[38;5;160m"     # error
    RESET="\033[0m"
else
    BOLD=""; DIM=""; ORANGE=""; MUTED=""; GREEN=""; YELLOW=""; RED=""; RESET=""
fi

# ─── Redirect stdin when piped (curl | bash fix) ──────────────────────────────
[ ! -t 0 ] && [ -e /dev/tty ] && exec < /dev/tty

# ─── CTRL+C trap ──────────────────────────────────────────────────────────────
trap 'printf "\n\n  ${RED}Cancelled.${RESET}\n\n"; exit 130' INT TERM

# ─── Helpers ──────────────────────────────────────────────────────────────────
rule()  { echo -e "  ${DIM}$(printf '─%.0s' {1..56})${RESET}"; }
ok()    { echo -e "  ${GREEN}✓${RESET}  ${BOLD}${1}${RESET}  ${MUTED}${2:-}${RESET}"; }
warn()  { echo -e "  ${YELLOW}·${RESET}  ${1}  ${MUTED}${2:-}${RESET}"; }
fail()  { echo -e "  ${RED}✗${RESET}  ${1}"; }
step()  { echo -e "\n  ${ORANGE}${1}${RESET}  ${BOLD}${2}${RESET}"; rule; }
label() { printf "  ${MUTED}%-24s${RESET}" "${1}"; }

# Read password one char at a time, printing • per keystroke; handles backspace
read_password() {
    local _pw="" _ch
    printf ""
    while IFS= read -r -s -n1 _ch; do
        if [[ -z "$_ch" ]]; then          # Enter pressed
            break
        elif [[ "$_ch" == $'\x7f' ]] || [[ "$_ch" == $'\b' ]]; then  # Backspace
            if [ ${#_pw} -gt 0 ]; then
                _pw="${_pw%?}"
                printf '\b \b'           # erase the last •
            fi
        else
            _pw+="$_ch"
            printf "${MUTED}•${RESET}"   # print a bullet per char
        fi
    done
    echo ""
    PASSWORD="$_pw"
}

# ─── Banner ───────────────────────────────────────────────────────────────────
clear
echo ""
echo -e "  ${BOLD}Campus Connect${RESET}  ${MUTED}·  macOS Installer${RESET} ·  CURAJ Wi-Fi${RESET}"
rule
echo ""

# ─── Step 1 · Credentials ─────────────────────────────────────────────────────
step "01" "Credentials"
echo -e "  ${MUTED}Stored locally in ~/.curaj-connect  ·  never sent externally${RESET}"
echo ""

label "Mobile Number"; printf "${BOLD}"; read -r USERNAME; printf "${RESET}"
if [ -z "$USERNAME" ]; then
    fail "Mobile Number cannot be empty."; exit 1
fi

label "Wi-Fi Password"; read_password
if [ -z "$PASSWORD" ]; then
    fail "Password cannot be empty."; exit 1
fi

echo ""
ok "Credentials saved"

CONFIG_DIR="$HOME/.curaj-connect"
SCRIPT_PATH="$CONFIG_DIR/campus-connect.sh"
PLIST_PATH="$HOME/Library/LaunchAgents/com.curaj.campusconnect.plist"

# ─── Step 2 · Setup ───────────────────────────────────────────────────────────
step "02" "Background Service"
echo ""

label "Config directory"; mkdir -p "$CONFIG_DIR"; chmod 700 "$CONFIG_DIR"
ok "~/.curaj-connect ready"

PRIMARY_URL="https://raw.githubusercontent.com/nitinya9av/campus-connect/master/mac/campus-connect.sh"
MIRROR_URL="https://cdn.jsdelivr.net/gh/nitinya9av/campus-connect@master/mac/campus-connect.sh"

label "Downloading client"
if ! curl -fsSL --connect-timeout 8 "$PRIMARY_URL" -o "$SCRIPT_PATH" 2>/dev/null; then
    warn "Primary slow — retrying mirror..."
    curl -fsSL --connect-timeout 12 "$MIRROR_URL" -o "$SCRIPT_PATH"
fi
chmod 755 "$SCRIPT_PATH"
ok "campus-connect.sh downloaded"

label "Registering daemon"
bash "$SCRIPT_PATH" --install "$USERNAME" "$PASSWORD" >/dev/null 2>&1
ok "launchd service registered"

# ─── Step 3 · Connection Test ─────────────────────────────────────────────────
step "03" "Connection Test"
echo ""

label "Captive portal check"
# Use the local perform_login directly (avoids depending on downloaded script version)
_PORTAL_IP="122.252.242.93"
_NAS_IP="1.254.254.254"
_nas_html=$(curl -s --max-time 1.5 "http://${_NAS_IP}/" 2>/dev/null)
_portal_url=$(echo "$_nas_html" | grep -ioE 'URL=http://[^"'\'' >]+' | cut -d'=' -f2)
_cookie_h=""
if [ -n "$_portal_url" ]; then
    _cookie=$(curl -s -I --max-time 1.5 "$_portal_url" 2>/dev/null \
        | grep -i 'Set-Cookie:' | grep -ioE 'JSESSIONID=[^;]+' | head -n 1)
    [ -n "$_cookie" ] && _cookie_h="Cookie: $_cookie"
fi
_resp=$(curl -s --max-time 2.5 -X POST \
    -H "Content-Type: application/x-www-form-urlencoded; charset=UTF-8" \
    -H "X-Requested-With: XMLHttpRequest" \
    -H "Referer: http://${_PORTAL_IP}/userportal/pages/usermedia/curaj/app/campus/ui/login.html" \
    ${_cookie_h:+-H "$_cookie_h"} \
    --data-urlencode "username=${USERNAME}" \
    --data-urlencode "password=${PASSWORD}" \
    -d "phone=0&type=2&jsonresponse=1" \
    "http://${_PORTAL_IP}/userportal/newlogin.do" 2>/dev/null)
if echo "$_resp" | grep -qE 'redirect_to_nas|success_net|"errorKey":"success"|Session already running'; then
    ok "Authenticated" "Internet is active"
else
    warn "Not on CURAJ Wi-Fi yet" "Will auto-login when connected"
fi

# ─── Done ─────────────────────────────────────────────────────────────────────
echo ""
rule
echo ""
echo -e "  ${GREEN}${BOLD}Setup complete.${RESET}  ${MUTED}Campus Connect is now running in the background.${RESET}"
echo -e "  ${MUTED}Your Mac will auto-login to CURAJ Wi-Fi in < 1 second.${RESET}"
echo ""
echo -e "  ${MUTED}--status     check daemon & connectivity${RESET}"
echo -e "  ${MUTED}--login      manual login test${RESET}"
echo -e "  ${MUTED}--uninstall  remove service & credentials${RESET}"
echo -e "  ${MUTED}via  ${RESET}${ORANGE}~/.curaj-connect/campus-connect.sh${RESET}"
echo ""
