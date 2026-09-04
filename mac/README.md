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

> **Note**: Connect your Mac to the internet (via mobile hotspot or log into campus Wi-Fi once in your browser) so Terminal can download the setup files from GitHub.

Open **Terminal** on your Mac (Press `Cmd + Space`, type `Terminal`, and press `Enter`), then paste:

```bash
curl -#fL https://raw.githubusercontent.com/nitinya9av/campus-connect/master/mac/install.sh | bash
```

A download progress bar (`######`) will appear briefly, then the installer launches and prompts for your Mobile Number and Password (masked with `•` dots as you type). The `launchd` background daemon is configured and started immediately.


---

## Manual Commands

| Command | Action |
| :--- | :--- |
| `~/.curaj-connect/campus-connect.sh --status` | Checks background daemon health & network connectivity. |
| `~/.curaj-connect/campus-connect.sh --login` | Tests immediate one-shot login. |
| `~/.curaj-connect/campus-connect.sh --uninstall` | Completely disables the background daemon and erases credentials. |
| `~/.curaj-connect/campus-connect.sh --install <user> <pass>` | Reconfigures credentials and starts the daemon. |
