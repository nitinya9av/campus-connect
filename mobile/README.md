# Campus Connect for Android (Expo React Native)

Modern, minimalist mobile client for CURAJ Wi-Fi authentication.

## Features
- **Editorial Dark Theme**: Warm paper & obsidian aesthetic matching the web portal and Windows client.
- **1-Click Auto-Login**: Enter credentials once; connects automatically when on campus.
- **100% Local**: Credentials stored securely on-device using AsyncStorage. Zero telemetry.
- **Direct Gateway Integration**: Directly communicates with `http://122.252.242.93/userportal/newlogin.do`.
- **Clean Deregistration**: Erases saved credentials and restores idle state with one tap.

---

## How to Run with Expo Go

1. **Install Dependencies**:
   ```bash
   bun install
   ```

2. **Start Expo Dev Server**:
   ```bash
   bun start
   ```

3. **Open on Android**:
   - Install **Expo Go** from the Google Play Store on your Android device.
   - Scan the QR code displayed in your terminal using the Expo Go app.

---

## How to Build a Standalone Android APK

To generate an installable `.apk` file:

```bash
bunx eas build -p android --profile preview
```
*(Requires a free Expo account at expo.dev)*

Or compile locally via native Android Gradle:
```bash
bunx expo prebuild
cd android && ./gradlew assembleRelease
```
