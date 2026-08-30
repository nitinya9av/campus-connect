#!/bin/bash

set -e

echo ""
echo "=================================================="
echo "   Campus Connect &middot; macOS Automated Installer"
echo "   CURAJ Wi-Fi 1-Click Background Service"
echo "=================================================="
echo ""

# Prompt for credentials
printf "Enter your Mobile Number (Username): "
read -r USERNAME
if [ -z "$USERNAME" ]; then
    echo "Error: Mobile Number cannot be empty."
    exit 1
fi

printf "Enter your Wi-Fi Password: "
# Read password silently
stty -echo 2>/dev/null || true
read -r PASSWORD
stty echo 2>/dev/null || true
echo ""

if [ -z "$PASSWORD" ]; then
    echo "Error: Password cannot be empty."
    exit 1
fi

CONFIG_DIR="$HOME/.curaj-connect"
SCRIPT_PATH="$CONFIG_DIR/campus-connect.sh"
PLIST_PATH="$HOME/Library/LaunchAgents/com.curaj.campusconnect.plist"

mkdir -p "$CONFIG_DIR"
chmod 700 "$CONFIG_DIR"

# Download the core campus-connect script
echo ""
echo "==> Downloading Campus Connect client..."
curl -sSL "https://raw.githubusercontent.com/nitinya9av/campus-connect/master/mac/campus-connect.sh" -o "$SCRIPT_PATH"
chmod 755 "$SCRIPT_PATH"

# Run installation
echo "==> Configuring native macOS launchd daemon..."
bash "$SCRIPT_PATH" --install "$USERNAME" "$PASSWORD"

echo ""
echo "=================================================="
echo "  ✓ SETUP COMPLETE!"
echo "  Campus Connect is now active in the background."
echo "  Whenever your Mac connects to CURAJ Wi-Fi,"
echo "  you will be authenticated automatically in <1s."
echo ""
echo "  To uninstall anytime, simply run:"
echo "    ~/.curaj-connect/campus-connect.sh --uninstall"
echo "=================================================="
echo ""
