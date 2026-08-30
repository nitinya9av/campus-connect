#!/bin/bash

PORTAL_IP="122.252.242.93"
NAS_IP="1.254.254.254"
CONFIG_DIR="$HOME/.curaj-connect"
CONFIG_FILE="$CONFIG_DIR/config.json"
PLIST_PATH="$HOME/Library/LaunchAgents/com.curaj.campusconnect.plist"
SCRIPT_PATH="$CONFIG_DIR/campus-connect.sh"

function perform_login() {
    local username="$1"
    local password="$2"

    # Step 1: Query Inventum NAS (1.254.254.254) for challenge URL
    local nas_html
    nas_html=$(curl -s --max-time 1.5 "http://${NAS_IP}/" 2>/dev/null)
    local portal_url
    portal_url=$(echo "$nas_html" | grep -ioE 'URL=http://[^"'\'' >]+' | cut -d'=' -f2)

    local cookie_header=""
    if [ -n "$portal_url" ]; then
        # Step 2: Grab JSESSIONID cookie from challenge URL
        local cookie
        cookie=$(curl -s -I --max-time 1.5 "$portal_url" 2>/dev/null | grep -i 'Set-Cookie:' | grep -ioE 'JSESSIONID=[^;]+' | head -n 1)
        if [ -n "$cookie" ]; then
            cookie_header="Cookie: $cookie"
        fi
    fi

    # Step 3: POST credentials to /userportal/newlogin.do
    local post_data
    post_data="username=$(perl -MURI::Escape -e 'print uri_escape($ARGV[0])' "$username" 2>/dev/null || echo "$username")&password=$(perl -MURI::Escape -e 'print uri_escape($ARGV[0])' "$password" 2>/dev/null || echo "$password")&phone=0&type=2&jsonresponse=1"

    local response
    response=$(curl -s --max-time 2.5 -X POST \
        -H "Content-Type: application/x-www-form-urlencoded; charset=UTF-8" \
        -H "X-Requested-With: XMLHttpRequest" \
        -H "Referer: http://${PORTAL_IP}/userportal/pages/usermedia/curaj/app/campus/ui/login.html" \
        ${cookie_header:+-H "$cookie_header"} \
        --data "$post_data" \
        "http://${PORTAL_IP}/userportal/newlogin.do" 2>/dev/null)

    # Step 4: Complete NAS controller handshake if redirect_to_nas is requested
    if echo "$response" | grep -q "redirect_to_nas"; then
        curl -s --max-time 1.2 "http://${NAS_IP}/" >/dev/null 2>&1
    fi

    if echo "$response" | grep -qE 'redirect_to_nas|success_net|"errorKey":"success"|Session already running'; then
        return 0
    fi

    return 1
}

function is_portal_reachable() {
    curl -s --max-time 1.2 "http://${NAS_IP}/" >/dev/null 2>&1
}

function is_online() {
    local code
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 1.2 "http://connectivitycheck.gstatic.com/generate_204" 2>/dev/null)
    [ "$code" = "204" ]
}

function install_daemon() {
    local username="$1"
    local password="$2"

    if [ -z "$username" ] || [ -z "$password" ]; then
        echo "Error: Username and Password required."
        echo "Usage: $0 --install <username> <password>"
        exit 1
    fi

    mkdir -p "$CONFIG_DIR"
    chmod 700 "$CONFIG_DIR"

    # Save credentials locally (user read-only)
    cat > "$CONFIG_FILE" <<EOF
{
  "username": "$username",
  "password": "$password"
}
EOF
    chmod 600 "$CONFIG_FILE"

    # Copy script to config dir
    cp "$0" "$SCRIPT_PATH"
    chmod 755 "$SCRIPT_PATH"

    # Create launchd LaunchAgent
    mkdir -p "$HOME/Library/LaunchAgents"
    cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.curaj.campusconnect</string>
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
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/dev/null</string>
    <key>StandardErrorPath</key>
    <string>/dev/null</string>
</dict>
</plist>
EOF

    # Register and start launchd service
    launchctl unload "$PLIST_PATH" 2>/dev/null
    launchctl load "$PLIST_PATH" 2>/dev/null

    echo "✓ Campus Connect daemon installed successfully on macOS!"
    echo "  Daemon registered at: $PLIST_PATH"
    echo "  Testing immediate login..."
    perform_login "$username" "$password" && echo "✓ Login successful! Internet is active." || echo "✓ Daemon active. Will login automatically when connected to campus Wi-Fi."
}

function uninstall_daemon() {
    launchctl unload "$PLIST_PATH" 2>/dev/null
    rm -f "$PLIST_PATH"
    rm -rf "$CONFIG_DIR"
    echo "✓ Campus Connect has been completely uninstalled from this Mac."
}

function run_trigger() {
    if [ ! -f "$CONFIG_FILE" ]; then
        exit 0
    fi

    # Read credentials from config.json
    local username
    local password
    username=$(grep -oE '"username":\s*"[^"]+"' "$CONFIG_FILE" | cut -d'"' -f4)
    password=$(grep -oE '"password":\s*"[^"]+"' "$CONFIG_FILE" | cut -d'"' -f4)

    if [ -z "$username" ] || [ -z "$password" ]; then
        exit 0
    fi

    # Fast-path check
    if is_portal_reachable; then
        perform_login "$username" "$password"
    fi
}

case "$1" in
    --install|-i)
        install_daemon "$2" "$3"
        ;;
    --uninstall|-u)
        uninstall_daemon
        ;;
    --run)
        run_trigger
        ;;
    --login|-l)
        if [ -f "$CONFIG_FILE" ]; then
            u=$(grep -oE '"username":\s*"[^"]+"' "$CONFIG_FILE" | cut -d'"' -f4)
            p=$(grep -oE '"password":\s*"[^"]+"' "$CONFIG_FILE" | cut -d'"' -f4)
            perform_login "$u" "$p" && echo "✓ Success" || echo "✗ Failed"
        else
            echo "No credentials saved. Run: $0 --install <username> <password>"
        fi
        ;;
    *)
        echo "Campus Connect for macOS"
        echo "Usage:"
        echo "  $0 --install <username> <password>  # Install and enable 24/7 background login"
        echo "  $0 --uninstall                      # Remove background daemon and credentials"
        echo "  $0 --login                          # Test immediate login"
        ;;
esac
