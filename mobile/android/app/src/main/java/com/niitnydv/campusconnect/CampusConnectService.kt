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
        const val CHANNEL_ID = "campus_connect_min_channel"
        const val NOTIFICATION_ID = 1001

        fun start(context: Context) {
            val intent = Intent(context, CampusConnectService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            val intent = Intent(context, CampusConnectService::class.java)
            context.stopService(intent)
        }
    }

    private val executor = Executors.newSingleThreadExecutor()
    private var connectivityManager: ConnectivityManager? = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    @Volatile private var isRunning = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createMinNotificationChannel()
        startForegroundWithMinNotification()
        registerNetworkWatcher()
        startPeriodicWatchdog()
        Log.i(TAG, "CampusConnectService running with MIN importance.")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        executor.execute {
            CampusConnectCore.checkAndAuthenticate(this, "service-start")
        }
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        isRunning = false
        unregisterNetworkWatcher()
        executor.shutdownNow()
        Log.i(TAG, "CampusConnectService stopped.")
    }

    private fun createMinNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Background Connection Service",
                NotificationManager.IMPORTANCE_MIN // Hidden from status bar, completely silent
            ).apply {
                description = "Enables automatic background Wi-Fi login without opening the app"
                setShowBadge(false)
                lockscreenVisibility = Notification.VISIBILITY_SECRET
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(channel)
        }
    }

    private fun buildMinNotification(): Notification {
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
            .setContentTitle("Campus Connect")
            .setContentText("Background auto-login active")
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_MIN) // No status bar icon, min priority
            .setVisibility(NotificationCompat.VISIBILITY_SECRET)
            .build()
    }

    private fun startForegroundWithMinNotification() {
        val notification = buildMinNotification()
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

    private fun startPeriodicWatchdog() {
        isRunning = true
        executor.execute {
            while (isRunning) {
                try {
                    Thread.sleep(15000)
                    if (isRunning) {
                        CampusConnectCore.checkAndAuthenticate(this@CampusConnectService, "watchdog")
                    }
                } catch (e: InterruptedException) {
                    break
                }
            }
        }
    }
}
