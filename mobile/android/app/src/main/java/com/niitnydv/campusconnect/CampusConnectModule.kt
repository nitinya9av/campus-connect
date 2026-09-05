package com.niitnydv.campusconnect

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
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
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("STOP_FAILED", e.message, e)
        }
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
