# Campus Connect for macOS

Native, lightweight Wi-Fi auto-login daemon for MacBooks and iMacs on the Central University of Rajasthan (CURAJ) network.

---

## Features
- **Zero GUI Overhead**: Runs natively via Apple's built-in `launchd` background daemon.
- **Hardware Network Event Trigger**: Wakes up in **0ms** the exact moment your Mac connects to `CURAJ-WIFI`.
- **Sub-Second Fast-Path (<1s)**: Connects to the local Inventum gateway controller and logs in immediately.
- **Local-Only & Private**: Credentials live strictly in `~/.curaj-connect/config.json` with user-only permissions (`600`).
- **1-Click Uninstall**: Completely removes the background daemon and deletes stored credentials with one flag.

---

## 1-Line Terminal Install

Open **Terminal** on your Mac (Press `Cmd + Space`, type `Terminal`, and press `Enter`), then paste:

```bash
curl -sSL https://raw.githubusercontent.com/nitinya9av/campus-connect/master/mac/install.sh | bash
```

The script will prompt for your Mobile Number and Password, configure the `launchd` service, and verify your connection immediately.

---

## Manual Commands

| Command | Action |
| :--- | :--- |
| `~/.curaj-connect/campus-connect.sh --login` | Tests immediate one-shot login. |
| `~/.curaj-connect/campus-connect.sh --uninstall` | Completely disables the background daemon and erases credentials. |
| `~/.curaj-connect/campus-connect.sh --install <user> <pass>` | Reconfigures credentials and starts the daemon. |
