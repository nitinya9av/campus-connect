# Campus Connect for iOS (iPhone & iPad)

Native, automated Wi-Fi auto-login for Apple iPhone and iPad using Apple's built-in **Shortcuts Automation**.

---

## Why Apple Shortcuts?
- **100% Native & Silent**: Runs natively through iOS without freezing or getting killed by iOS background restrictions.
- **Zero Third-Party Apps**: Uses the official Apple Shortcuts app pre-installed on every iPhone (iOS 13+).
- **Zero Battery Drain**: Only triggers the exact moment your iPhone connects to campus Wi-Fi.
- **Privacy & Safety**: Your credentials never leave your personal iCloud Keychain.

---

## 3-Minute Setup Guide

### Step 1: Open Shortcuts Automation
1. Open the built-in **Shortcuts** app on your iPhone.
2. Tap the **Automation** tab at the bottom center.
3. Tap the **`+`** icon in the top-right corner to create a Personal Automation.

### Step 2: Set the Wi-Fi Trigger
1. Scroll down and tap **Wi-Fi**.
2. Tap **Choose** next to Network, and select **`CURAJ-WIFI`** (or your hostel/department network).
3. Under *When*, select **Is Connected**.
4. Select **Run Immediately** and toggle off **Notify When Run**.
5. Tap **Next**.

### Step 3: Add the Authentication Actions
1. Tap **New Blank Automation** &rarr; **Add Action**.
2. Search for **"Get Contents of URL"** and add it:
   - **URL**: `http://1.254.254.254/`
   - (This primes the local Inventum router session).
3. Search for **"Get Contents of URL"** again and add a second action:
   - **URL**: `http://122.252.242.93/userportal/newlogin.do`
   - Tap the dropdown arrow &rarr; set **Method** to **POST**.
   - Set **Request Body** to **Form**.
   - Add the following 5 fields:
     - `username` &rarr; `Your Mobile Number`
     - `password` &rarr; `Your Password`
     - `phone` &rarr; `0`
     - `type` &rarr; `2`
     - `jsonresponse` &rarr; `1`
4. Add a third **"Get Contents of URL"** action:
   - **URL**: `http://1.254.254.254/`
   - (This bypasses the firewall and activates external internet).
5. Tap **Done** in the top-right corner.

---

## Verification
Turn off Wi-Fi in your iPhone Control Center, then turn it back on. Within 1–2 seconds, iOS will run the shortcut in the background and your internet will be active!
