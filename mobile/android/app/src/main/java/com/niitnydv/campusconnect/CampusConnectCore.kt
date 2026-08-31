package com.niitnydv.campusconnect

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.os.Build
import android.util.Log
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.regex.Pattern

object CampusConnectCore {
    private const val TAG = "CampusConnectCore"

    const val PREFS_NAME = "campus_connect_prefs"
    const val KEY_USERNAME = "username"
    const val KEY_PASSWORD = "password"
    const val KEY_ENABLED = "enabled"

    private const val GATEWAY_LOGIN_URL = "http://122.252.242.93/userportal/newlogin.do"
    private const val GATEWAY_PORTAL_URL = "http://122.252.242.93/userportal/pages/usermedia/curaj/app/campus/ui/login.html"
    private const val NAS_URL = "http://1.254.254.254/"
    private const val PROBE_URL = "http://connectivitycheck.gstatic.com/generate_204"

    fun getWifiNetwork(context: Context): Network? {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return null
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            for (net in cm.allNetworks) {
                val caps = cm.getNetworkCapabilities(net)
                if (caps?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true) {
                    return net
                }
            }
        }
        return null
    }

    fun getWifiSsid(context: Context): String? {
        return try {
            val wm = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
            val raw = wm?.connectionInfo?.ssid
            if (raw != null && raw.isNotEmpty() && raw != "<unknown ssid>") {
                raw.replace("\"", "").trim()
            } else {
                null
            }
        } catch (e: Exception) {
            null
        }
    }

    const val CURAJ_OFFICIAL_SSID = "CURAJ CAMPUS CONNECT"

    fun isCurajSsid(ssid: String?): Boolean {
        if (ssid == null) return false
        val clean = ssid.replace("\"", "").trim()
        if (clean.equals(CURAJ_OFFICIAL_SSID, ignoreCase = true)) return true
        val upper = clean.uppercase()
        return upper.contains("CURAJ") || upper.contains("CAMPUS CONNECT")
    }

    fun openConnection(url: URL, network: Network?): HttpURLConnection {
        return if (network != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            network.openConnection(url) as HttpURLConnection
        } else {
            url.openConnection() as HttpURLConnection
        }
    }

    private val PROBE_URLS = arrayOf(
        "http://connectivitycheck.gstatic.com/generate_204",
        "https://www.google.com/generate_204",
        "http://www.google.com/generate_204"
    )

    fun isInternetOnline(network: Network? = null): Boolean {
        for (probeUrl in PROBE_URLS) {
            try {
                val url = URL(probeUrl)
                val conn = openConnection(url, network).apply {
                    connectTimeout = 1500
                    readTimeout = 1500
                    instanceFollowRedirects = false
                    useCaches = false
                }
                conn.connect()
                val code = conn.responseCode
                conn.disconnect()
                if (code == 204 || code == 200) return true
            } catch (_: Exception) {}
        }
        return false
    }

    fun checkAndAuthenticate(context: Context, trigger: String, explicitNetwork: Network? = null) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val username = prefs.getString(KEY_USERNAME, null) ?: return
        val password = prefs.getString(KEY_PASSWORD, null) ?: return
        val isEnabled = prefs.getBoolean(KEY_ENABLED, true)
        if (!isEnabled || username.isEmpty() || password.isEmpty()) return

        val wifiNetwork = explicitNetwork ?: getWifiNetwork(context)
        Log.i(TAG, "Instant auto-login triggered ($trigger) for $username (wifiNetwork: $wifiNetwork)...")
        val success = performLogin(context, username, password, wifiNetwork)
        if (success) {
            Log.i(TAG, "Instant auto-login succeeded!")
        }
    }

    fun performLogin(context: Context, user: String, pass: String, wifiNetwork: Network? = null): Boolean {
        val network = wifiNetwork ?: getWifiNetwork(context)
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager

        // Crucial: Bind process to the Wi-Fi network interface so requests bypass cellular fallback
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && network != null) {
            try {
                cm?.bindProcessToNetwork(network)
                Log.d(TAG, "Process bound to Wi-Fi network interface.")
            } catch (e: Exception) {
                Log.w(TAG, "Could not bind process to network: ${e.message}")
            }
        }

        var sessionCookie: String? = null

        // Step 1: Query Inventum NAS (1.254.254.254) directly over Wi-Fi
        try {
            val nasUrl = URL(NAS_URL)
            val nasConn = openConnection(nasUrl, network).apply {
                connectTimeout = 1500
                readTimeout = 1500
                instanceFollowRedirects = false
            }
            val html = BufferedReader(InputStreamReader(nasConn.inputStream)).use { it.readText() }
            nasConn.disconnect()

            val pattern = Pattern.compile("URL=(http://[^\"'>\\s]+)", Pattern.CASE_INSENSITIVE)
            val matcher = pattern.matcher(html)
            if (matcher.find()) {
                val portalChallengeUrl = matcher.group(1)
                if (portalChallengeUrl != null) {
                    val portalConn = openConnection(URL(portalChallengeUrl), network).apply {
                        connectTimeout = 2000
                        readTimeout = 2000
                    }
                    val setCookie = portalConn.getHeaderField("Set-Cookie")
                    portalConn.disconnect()

                    if (setCookie != null) {
                        val cookieMatcher = Pattern.compile("(JSESSIONID=[^;]+)", Pattern.CASE_INSENSITIVE).matcher(setCookie)
                        if (cookieMatcher.find()) {
                            sessionCookie = cookieMatcher.group(1)
                        }
                    }
                }
            } else {
                // If NAS did not return a challenge, verify if Wi-Fi interface already has internet
                if (isInternetOnline(network)) {
                    Log.d(TAG, "Wi-Fi already online, skipping login.")
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && network != null) {
                        cm?.reportNetworkConnectivity(network, true)
                    }
                    return true
                }
            }
        } catch (e: Exception) {
            Log.d(TAG, "NAS check notice: ${e.message}")
            if (isInternetOnline(network)) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && network != null) {
                    cm?.reportNetworkConnectivity(network, true)
                }
                return true
            }
        }

        // Step 2: POST credentials to /userportal/newlogin.do specifically over Wi-Fi
        try {
            val loginUrl = URL(GATEWAY_LOGIN_URL)
            val body = "username=" + URLEncoder.encode(user, "UTF-8") +
                    "&password=" + URLEncoder.encode(pass, "UTF-8") +
                    "&phone=0&type=2&jsonresponse=1"

            val conn = openConnection(loginUrl, network).apply {
                requestMethod = "POST"
                connectTimeout = 3000
                readTimeout = 3000
                doOutput = true
                setRequestProperty("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
                setRequestProperty("X-Requested-With", "XMLHttpRequest")
                setRequestProperty("Referer", GATEWAY_PORTAL_URL)
                setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 14) CampusConnect/1.0")
                if (sessionCookie != null) {
                    setRequestProperty("Cookie", sessionCookie)
                }
            }

            conn.outputStream.use { os: OutputStream ->
                os.write(body.toByteArray(Charsets.UTF_8))
                os.flush()
            }

            val resp = BufferedReader(InputStreamReader(conn.inputStream)).use { it.readText() }
            conn.disconnect()

            // Step 3: Trigger NAS controller handshake ping if requested
            if (resp.contains("redirect_to_nas", ignoreCase = true)) {
                try {
                    val pingConn = openConnection(URL(NAS_URL), network).apply {
                        connectTimeout = 1500
                        readTimeout = 1500
                    }
                    pingConn.connect()
                    pingConn.responseCode
                    pingConn.disconnect()
                } catch (_: Exception) {}
            }

            val isSuccess = resp.contains("redirect_to_nas", ignoreCase = true) ||
                    resp.contains("success_net", ignoreCase = true) ||
                    resp.contains("\"errorKey\":\"success\"", ignoreCase = true) ||
                    resp.contains("Session already running", ignoreCase = true)

            if (isSuccess) {
                Log.i(TAG, "Gateway authenticated successfully.")
                // Tell Android OS that Wi-Fi now has verified internet so it clears "Sign in required" notification
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && network != null) {
                    cm?.reportNetworkConnectivity(network, true)
                }
                return true
            }
        } catch (e: Exception) {
            Log.e(TAG, "PerformLogin error: ${e.message}")
        }

        val online = isInternetOnline(network)
        if (online && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && network != null) {
            cm?.reportNetworkConnectivity(network, true)
        }
        return online
    }
}
