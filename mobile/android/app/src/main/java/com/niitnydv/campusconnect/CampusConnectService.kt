package com.niitnydv.campusconnect

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import java.util.concurrent.Executors

class CampusConnectService : Service() {

    companion object {
        private const val TAG = "CampusConnectService"
        const val CHANNEL_ID = "campus_connect_fg_channel"
        const val NOTIFICATION_ID = 1001

        @Volatile
        var isRunning = false
            private set

        fun isServiceRunning(): Boolean = isRunning

        fun start(context: Context) {
            val intent = Intent(context, CampusConnectService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            isRunning = false
            CampusConnectWatchdogReceiver.cancel(context)
            val intent = Intent(context, CampusConnectService::class.java)
            context.stopService(intent)
        }
    }

    private val executor = Executors.newSingleThreadExecutor()
    private var connectivityManager: ConnectivityManager? = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        isRunning = true
        createNotificationChannel()
        startForegroundWithPersistentNotification()
        registerNetworkWatcher()

        // Arm the self-healing watchdog dead man's switch
        CampusConnectWatchdogReceiver.schedule(this)
        Log.i(TAG, "CampusConnectService initialized with persistent foreground priority & watchdog.")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        isRunning = true

        executor.execute {
            CampusConnectCore.checkAndAuthenticate(this, "service-start")
        }

        // Re-arm watchdog to ensure ongoing resilience
        CampusConnectWatchdogReceiver.schedule(this)
        return START_STICKY
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        super.onTaskRemoved(rootIntent)
        Log.w(TAG, "App task removed from recents. Ensuring watchdog and service persistence...")
        // If user swiped app away, ensure watchdog wakes up in 3 seconds to guarantee service stays alive
        CampusConnectWatchdogReceiver.schedule(this, 3000)
    }

    override fun onDestroy() {
        super.onDestroy()
        val wasRunning = isRunning
        isRunning = false
        unregisterNetworkWatcher()
        executor.shutdownNow()

        // Check if user still has auto-connect enabled; if so, resurrect service automatically
        val prefs = getSharedPreferences(CampusConnectCore.PREFS_NAME, Context.MODE_PRIVATE)
        val isEnabled = prefs.getBoolean(CampusConnectCore.KEY_ENABLED, false)
        val username = prefs.getString(CampusConnectCore.KEY_USERNAME, "")

        if (wasRunning && isEnabled && !username.isNullOrEmpty()) {
            Log.w(TAG, "Service destroyed while enabled. Scheduling immediate resurrection...")
            CampusConnectWatchdogReceiver.schedule(this, 3000)
        } else {
            Log.i(TAG, "CampusConnectService stopped.")
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Campus Connect Service",
                NotificationManager.IMPORTANCE_LOW // Silent, non-intrusive, but keeps process foreground
            ).apply {
                description = "Keeps auto-login active and connects automatically to CURAJ Wi-Fi"
                setShowBadge(false)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification {
        val launchIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("CURAJ Campus Connect")
            .setContentText("Auto-login active • Monitoring campus Wi-Fi")
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .build()
    }

    private fun startForegroundWithPersistentNotification() {
        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun registerNetworkWatcher() {
        connectivityManager = getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
        val request = NetworkRequest.Builder()
            .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
            .build()

        networkCallback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                Log.d(TAG, "Wi-Fi connected. Executing instant login...")
                executor.execute {
                    CampusConnectCore.checkAndAuthenticate(this@CampusConnectService, "wifi-connected", network)
                }
            }

            override fun onLost(network: Network) {
                Log.d(TAG, "Wi-Fi disconnected.")
            }
        }

        try {
            connectivityManager?.registerNetworkCallback(request, networkCallback!!)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to register network callback", e)
        }
    }

    private fun unregisterNetworkWatcher() {
        try {
            networkCallback?.let { connectivityManager?.unregisterNetworkCallback(it) }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to unregister network callback", e)
        }
    }
}
