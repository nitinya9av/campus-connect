#!/bin/bash

# ─── Colors (portal theme: warm foreground, terracotta accent) ────────────────
if [ -t 1 ]; then
    BOLD="\033[1m"
    DIM="\033[2m"
    ORANGE="\033[38;5;166m"   # terracotta accent  ≈ #c2410c
    MUTED="\033[38;5;245m"   # muted              ≈ #686259
    GREEN="\033[38;5;71m"    # success
    YELLOW="\033[38;5;179m"  # warning
    RED="\033[38;5;160m"     # error
    RESET="\033[0m"
else
    BOLD=""; DIM=""; ORANGE=""; MUTED=""; GREEN=""; YELLOW=""; RED=""; RESET=""
fi

# ─── Config Paths ─────────────────────────────────────────────────────────────
PORTAL_IP="122.252.242.93"
NAS_IP="1.254.254.254"
CONFIG_DIR="$HOME/.curaj-connect"
CONFIG_FILE="$CONFIG_DIR/config.json"
PLIST_PATH="$HOME/Library/LaunchAgents/com.curaj.campusconnect.plist"
SCRIPT_PATH="$CONFIG_DIR/campus-connect.sh"

# ─── Helpers ──────────────────────────────────────────────────────────────────
rule()  { echo -e "  ${DIM}$(printf '─%.0s' {1..56})${RESET}"; }
ok()    { echo -e "  ${GREEN}✓${RESET}  ${BOLD}${1}${RESET}  ${MUTED}${2:-}${RESET}"; }
warn()  { echo -e "  ${YELLOW}·${RESET}  ${1}  ${MUTED}${2:-}${RESET}"; }
fail()  { echo -e "  ${RED}✗${RESET}  ${BOLD}${1}${RESET}  ${MUTED}${2:-}${RESET}"; }
label() { printf "  ${MUTED}%-22s${RESET}" "${1}"; }
section() {
    echo ""
    echo -e "  ${ORANGE}${1}${RESET}  ${BOLD}${2}${RESET}"
    rule
}

# ─── Core Login Logic ─────────────────────────────────────────────────────────
function perform_login() {
    local username="$1" password="$2"

    local nas_html portal_url cookie_header="" cookie response
    nas_html=$(curl -s --max-time 1.5 "http://${NAS_IP}/" 2>/dev/null)
    portal_url=$(echo "$nas_html" | grep -ioE 'URL=http://[^"'\'' >]+' | cut -d'=' -f2)

    if [ -n "$portal_url" ]; then
        cookie=$(curl -s -I --max-time 1.5 "$portal_url" 2>/dev/null \
            | grep -i 'Set-Cookie:' | grep -ioE 'JSESSIONID=[^;]+' | head -n 1)
        [ -n "$cookie" ] && cookie_header="Cookie: $cookie"
    fi

    response=$(curl -s --max-time 2.5 -X POST \
        -H "Content-Type: application/x-www-form-urlencoded; charset=UTF-8" \
        -H "X-Requested-With: XMLHttpRequest" \
        -H "Referer: http://${PORTAL_IP}/userportal/pages/usermedia/curaj/app/campus/ui/login.html" \
        ${cookie_header:+-H "$cookie_header"} \
        --data-urlencode "username=${username}" \
        --data-urlencode "password=${password}" \
        -d "phone=0&type=2&jsonresponse=1" \
        "http://${PORTAL_IP}/userportal/newlogin.do" 2>/dev/null)

    if echo "$response" | grep -q "redirect_to_nas"; then
        curl -s --max-time 1.2 "http://${NAS_IP}/" >/dev/null 2>&1
    fi

    echo "$response" | grep -qE 'redirect_to_nas|success_net|"errorKey":"success"|Session already running'
}

function is_portal_reachable() {
    curl -s --max-time 1.2 "http://${NAS_IP}/" >/dev/null 2>&1
}

function is_online() {
    local code
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 1.2 \
        "http://connectivitycheck.gstatic.com/generate_204" 2>/dev/null)
    [ "$code" = "204" ]
}

# ─── Install ──────────────────────────────────────────────────────────────────
function install_daemon() {
    local username="$1" password="$2"

    if [ -z "$username" ] || [ -z "$password" ]; then
        fail "Username and password are required."
        echo -e "  ${MUTED}Usage: $0 --install <username> <password>${RESET}"
        exit 1
    fi

    mkdir -p "$CONFIG_DIR"; chmod 700 "$CONFIG_DIR"
    cat > "$CONFIG_FILE" <<EOF
{
  "username": "$username",
  "password": "$password"
}
EOF
    chmod 600 "$CONFIG_FILE"

    if [ -f "$0" ] && [ "$0" != "$SCRIPT_PATH" ]; then
        cp "$0" "$SCRIPT_PATH" 2>/dev/null || true
    fi
    chmod 755 "$SCRIPT_PATH"

    mkdir -p "$HOME/Library/LaunchAgents"
    cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>       <string>com.curaj.campusconnect</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>$SCRIPT_PATH</string>
        <string>--run</string>
    </array>
    <key>WatchPaths</key>
    <array>
        <string>/Library/Preferences/SystemConfiguration/com.apple.airport.preferences.plist</string>
        <string>/etc/resolv.conf</string>
    </array>
    <key>RunAtLoad</key>        <true/>
    <key>StandardOutPath</key>  <string>/dev/null</string>
    <key>StandardErrorPath</key><string>/dev/null</string>
</dict>
</plist>
EOF

    if command -v launchctl >/dev/null 2>&1; then
        launchctl unload "$PLIST_PATH" 2>/dev/null || true
        launchctl load  "$PLIST_PATH" 2>/dev/null || true
        ok "launchd daemon registered" "$PLIST_PATH"
    else
        ok "Credentials saved" "(launchctl not available on this shell)"
    fi

    label "Testing connection"
    if perform_login "$username" "$password"; then
        ok "Authenticated" "Internet is active"
    else
        warn "Service registered" "Will authenticate automatically on CURAJ Wi-Fi"
    fi
}

# ─── Uninstall ────────────────────────────────────────────────────────────────
function uninstall_daemon() {
    echo ""
    echo -e "  ${BOLD}Campus Connect${RESET}  ${MUTED}·  Uninstaller${RESET}"
    rule
    echo ""

    if command -v launchctl >/dev/null 2>&1; then
        label "Unloading daemon"
        launchctl unload "$PLIST_PATH" 2>/dev/null || true
        ok "launchd service stopped"
    fi

    label "Removing plist"
    rm -f "$PLIST_PATH"
    ok "Plist removed"

    label "Deleting credentials"
    rm -rf "$CONFIG_DIR"
    ok "~/.curaj-connect deleted"

    echo ""
    rule
    echo -e "\n  ${GREEN}✓${RESET}  Completely uninstalled.\n"
}

# ─── Status ───────────────────────────────────────────────────────────────────
function show_status() {
    echo ""
    echo -e "  ${BOLD}Campus Connect${RESET}  ${MUTED}·  Status${RESET}"
    rule
    echo ""

    # Daemon
    label "Background daemon"
    if command -v launchctl >/dev/null 2>&1; then
        if launchctl list 2>/dev/null | grep -q "com.curaj.campusconnect"; then
            ok "Active" "(launchd loaded)"
        else
            warn "Inactive" "(not loaded)"
        fi
    else
        echo -e "${MUTED}n/a  (macOS only)${RESET}"
    fi

    # Saved account
    label "Saved account"
    if [ -f "$CONFIG_FILE" ]; then
        local user
        user=$(grep -oE '"username":\s*"[^"]+"' "$CONFIG_FILE" 2>/dev/null | cut -d'"' -f4)
        if [ -n "$user" ]; then
            local len="${#user}"
            if [ "$len" -gt 4 ]; then
                ok "${user:0:2}••••••${user: -2}" "$CONFIG_FILE"
            else
                ok "$user"
            fi
        else
            warn "Config found but empty"
        fi
    else
        warn "Not configured" "(run --install)"
    fi

    # Gateway
    label "CURAJ gateway"
    if is_portal_reachable; then
        ok "Reachable" "(${NAS_IP})"
    else
        warn "Not on CURAJ Wi-Fi"
    fi

    # Internet
    label "Internet"
    if is_online; then
        ok "Online" "(verified)"
    else
        warn "Offline" "(captive portal may be blocking)"
    fi

    echo ""
    rule
    echo ""
}

# ─── Background trigger (called by launchd) ───────────────────────────────────
function run_trigger() {
    [ -f "$CONFIG_FILE" ] || exit 0
    local u p
    u=$(grep -oE '"username":\s*"[^"]+"' "$CONFIG_FILE" | cut -d'"' -f4)
    p=$(grep -oE '"password":\s*"[^"]+"' "$CONFIG_FILE" | cut -d'"' -f4)
    [ -z "$u" ] || [ -z "$p" ] && exit 0
    is_portal_reachable && perform_login "$u" "$p"
}

# ─── Command Router ───────────────────────────────────────────────────────────
case "${1:-}" in

    --install|-i)
        install_daemon "${2:-}" "${3:-}"
        ;;

    --uninstall|-u)
        uninstall_daemon
        ;;

    --status|-s)
        show_status
        ;;

    --run)
        run_trigger
        ;;

    --login-silent)
        if [ -f "$CONFIG_FILE" ]; then
            u=$(grep -oE '"username":\s*"[^"]+"' "$CONFIG_FILE" | cut -d'"' -f4)
            p=$(grep -oE '"password":\s*"[^"]+"' "$CONFIG_FILE" | cut -d'"' -f4)
            perform_login "$u" "$p"
        else
            exit 1
        fi
        ;;

    --login|-l)
        echo ""
        echo -e "  ${BOLD}Campus Connect${RESET}  ${MUTED}·  Login Test${RESET}"
        rule
        echo ""
        if [ -f "$CONFIG_FILE" ]; then
            u=$(grep -oE '"username":\s*"[^"]+"' "$CONFIG_FILE" | cut -d'"' -f4)
            p=$(grep -oE '"password":\s*"[^"]+"' "$CONFIG_FILE" | cut -d'"' -f4)
            label "Authenticating"
            if perform_login "$u" "$p"; then
                ok "Success" "Internet is active"
            else
                fail "Login failed" "Check credentials or Wi-Fi connection"
            fi
        else
            fail "No credentials found" "Run: $0 --install <username> <password>"
        fi
        echo ""
        ;;

    *)
        echo ""
        echo -e "  ${BOLD}Campus Connect${RESET}  ${MUTED}·  macOS Wi-Fi Client${RESET}"
        rule
        echo -e "  ${MUTED}Central University of Rajasthan (CURAJ)${RESET}"
        echo ""
        echo -e "  ${ORANGE}--status,    -s${RESET}                 check daemon & connectivity"
        echo -e "  ${ORANGE}--login,     -l${RESET}                 manual login test"
        echo -e "  ${ORANGE}--uninstall, -u${RESET}                 remove service & erase credentials"
        echo -e "  ${ORANGE}--install <user> <pass>${RESET}         reconfigure & re-register daemon"
        echo ""
        rule
        echo ""
        ;;

esac
