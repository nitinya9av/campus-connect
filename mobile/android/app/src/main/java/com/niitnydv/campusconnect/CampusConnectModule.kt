package com.niitnydv.campusconnect

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.net.URL

class CampusConnectModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "CampusConnectModule"

    @ReactMethod
    fun startBackgroundService(username: String, password: String, promise: Promise) {
        try {
            val prefs = reactContext.getSharedPreferences(
                CampusConnectCore.PREFS_NAME,
                Context.MODE_PRIVATE
            )
            prefs.edit()
                .putString(CampusConnectCore.KEY_USERNAME, username)
                .putString(CampusConnectCore.KEY_PASSWORD, password)
                .putBoolean(CampusConnectCore.KEY_ENABLED, true)
                .apply()

            CampusConnectService.start(reactContext)
            CampusConnectWatchdogReceiver.schedule(reactContext, 5000)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("CONFIG_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun stopBackgroundService(promise: Promise) {
        try {
            val prefs = reactContext.getSharedPreferences(
                CampusConnectCore.PREFS_NAME,
                Context.MODE_PRIVATE
            )
            prefs.edit()
                .putBoolean(CampusConnectCore.KEY_ENABLED, false)
                .putString(CampusConnectCore.KEY_USERNAME, "")
                .putString(CampusConnectCore.KEY_PASSWORD, "")
                .apply()

            CampusConnectService.stop(reactContext)
            CampusConnectWatchdogReceiver.cancel(reactContext)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("STOP_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun isServiceRunning(promise: Promise) {
        promise.resolve(CampusConnectService.isServiceRunning())
    }

    @ReactMethod
    fun getManufacturer(promise: Promise) {
        promise.resolve(Build.MANUFACTURER.lowercase())
    }

    @ReactMethod
    fun isBatteryOptimizationIgnored(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val pm = reactContext.getSystemService(Context.POWER_SERVICE) as? PowerManager
                val isIgnored = pm?.isIgnoringBatteryOptimizations(reactContext.packageName) == true
                promise.resolve(isIgnored)
            } else {
                promise.resolve(true)
            }
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun requestIgnoreBatteryOptimization(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val pm = reactContext.getSystemService(Context.POWER_SERVICE) as? PowerManager
                if (pm?.isIgnoringBatteryOptimizations(reactContext.packageName) == false) {
                    val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                        data = Uri.parse("package:${reactContext.packageName}")
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                    reactContext.startActivity(intent)
                    promise.resolve(true)
                    return
                }
            }
            promise.resolve(false)
        } catch (e: Exception) {
            // Fallback: open battery saver settings list
            try {
                val fallbackIntent = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                reactContext.startActivity(fallbackIntent)
                promise.resolve(true)
            } catch (ex: Exception) {
                promise.reject("BATTERY_OPT_ERROR", ex.message, ex)
            }
        }
    }

    @ReactMethod
    fun openOemAutostartSettings(promise: Promise) {
        val manufacturer = Build.MANUFACTURER.lowercase()
        val intentsToTry = mutableListOf<Intent>()

        when {
            manufacturer.contains("xiaomi") || manufacturer.contains("redmi") || manufacturer.contains("poco") -> {
                intentsToTry.add(Intent().setComponent(ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity")))
                intentsToTry.add(Intent().setComponent(ComponentName("com.miui.securitycenter", "com.miui.powercenter.PowerSettings")))
            }
            manufacturer.contains("samsung") -> {
                intentsToTry.add(Intent().setComponent(ComponentName("com.samsung.android.lool", "com.samsung.android.sm.ui.battery.BatteryActivity")))
                intentsToTry.add(Intent().setComponent(ComponentName("com.samsung.android.sm", "com.samsung.android.sm.ui.battery.BatteryActivity")))
            }
            manufacturer.contains("oppo") -> {
                intentsToTry.add(Intent().setComponent(ComponentName("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity")))
                intentsToTry.add(Intent().setComponent(ComponentName("com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity")))
            }
            manufacturer.contains("vivo") || manufacturer.contains("iqoo") -> {
                intentsToTry.add(Intent().setComponent(ComponentName("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity")))
                intentsToTry.add(Intent().setComponent(ComponentName("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity")))
            }
            manufacturer.contains("realme") -> {
                intentsToTry.add(Intent().setComponent(ComponentName("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity")))
                intentsToTry.add(Intent().setComponent(ComponentName("com.realme.security", "com.realme.security.permission.startup.StartupAppListActivity")))
            }
            manufacturer.contains("oneplus") -> {
                intentsToTry.add(Intent().setComponent(ComponentName("com.oneplus.security", "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity")))
            }
        }

        // Generic fallback to application details
        val appDetailsIntent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
            data = Uri.parse("package:${reactContext.packageName}")
        }
        intentsToTry.add(appDetailsIntent)

        for (intent in intentsToTry) {
            try {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                reactContext.startActivity(intent)
                promise.resolve(true)
                return
            } catch (_: Exception) {
                // Try next intent
            }
        }

        promise.resolve(false)
    }

    @ReactMethod
    fun getWifiStatus(promise: Promise) {
        try {
            val context = reactContext
            val wifiNetwork = CampusConnectCore.getWifiNetwork(context)
            val isWifiConnected = wifiNetwork != null
            val ssid = CampusConnectCore.getWifiSsid(context) ?: ""
            val isCurajSsid = CampusConnectCore.isCurajSsid(ssid)

            val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            var hasCellular = false
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && cm != null) {
                for (net in cm.allNetworks) {
                    val caps = cm.getNetworkCapabilities(net)
                    if (caps?.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) == true) {
                        hasCellular = true
                        break
                    }
                }
            }

            // Probe local NAS (1.254.254.254) specifically over Wi-Fi
            var isCurajPortalReachable = false
            if (wifiNetwork != null) {
                try {
                    val conn = CampusConnectCore.openConnection(URL("http://1.254.254.254/"), wifiNetwork).apply {
                        connectTimeout = 1200
                        readTimeout = 1200
                    }
                    conn.connect()
                    isCurajPortalReachable = conn.responseCode in 200..399
                    conn.disconnect()
                } catch (_: Exception) {}
            }

            var isWifiOnline = false
            if (wifiNetwork != null) {
                isWifiOnline = CampusConnectCore.isInternetOnline(wifiNetwork)
                if (isWifiOnline && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    cm?.reportNetworkConnectivity(wifiNetwork, true)
                }
            }

            val map = Arguments.createMap().apply {
                putBoolean("isWifiConnected", isWifiConnected)
                putString("ssid", ssid)
                putBoolean("isCurajSsid", isCurajSsid)
                putBoolean("isCurajPortalReachable", isCurajPortalReachable)
                putBoolean("isWifiOnline", isWifiOnline)
                putBoolean("hasCellular", hasCellular)
                putBoolean("isServiceRunning", CampusConnectService.isServiceRunning())
            }
            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("STATUS_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun authenticateWifi(promise: Promise) {
        try {
            val context = reactContext
            val prefs = context.getSharedPreferences(CampusConnectCore.PREFS_NAME, Context.MODE_PRIVATE)
            val username = prefs.getString(CampusConnectCore.KEY_USERNAME, null) ?: ""
            val password = prefs.getString(CampusConnectCore.KEY_PASSWORD, null) ?: ""
            if (username.isEmpty() || password.isEmpty()) {
                val map = Arguments.createMap().apply {
                    putBoolean("success", false)
                    putString("message", "No credentials saved")
                }
                promise.resolve(map)
                return
            }

            val wifiNetwork = CampusConnectCore.getWifiNetwork(context)
            val success = CampusConnectCore.performLogin(context, username, password, wifiNetwork)
            if (success && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && wifiNetwork != null) {
                val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
                cm?.reportNetworkConnectivity(wifiNetwork, true)
            }
            val map = Arguments.createMap().apply {
                putBoolean("success", success)
                putString("message", if (success) "Connected successfully to CURAJ Wi-Fi." else "Failed to authenticate with CURAJ gateway.")
            }
            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("AUTH_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun reportNetworkConnectivity(promise: Promise) {
        try {
            val context = reactContext
            val wifiNetwork = CampusConnectCore.getWifiNetwork(context)
            if (wifiNetwork != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
                cm?.reportNetworkConnectivity(wifiNetwork, true)
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("REPORT_FAILED", e.message, e)
        }
    }
}
