package com.niitnydv.campusconnect

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.PowerManager
import android.util.Log
import java.util.concurrent.Executors

class CampusConnectWatchdogReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "CampusConnectWatchdog"
        const val ACTION_WATCHDOG_HEARTBEAT = "com.niitnydv.campusconnect.ACTION_WATCHDOG_HEARTBEAT"
        private const val REQUEST_CODE = 9001
        const val DEFAULT_INTERVAL_MS = 15 * 60 * 1000L // 15 minutes heartbeat

        private val executor = Executors.newSingleThreadExecutor()

        fun schedule(context: Context, delayMillis: Long = DEFAULT_INTERVAL_MS) {
            try {
                val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
                val intent = Intent(context, CampusConnectWatchdogReceiver::class.java).apply {
                    action = ACTION_WATCHDOG_HEARTBEAT
                }
                val pendingIntent = PendingIntent.getBroadcast(
                    context,
                    REQUEST_CODE,
                    intent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )

                val triggerAt = System.currentTimeMillis() + delayMillis

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    try {
                        alarmManager.setExactAndAllowWhileIdle(
                            AlarmManager.RTC_WAKEUP,
                            triggerAt,
                            pendingIntent
                        )
                    } catch (se: SecurityException) {
                        Log.w(TAG, "Exact alarm permission restricted, falling back to inexact idle alarm: ${se.message}")
                        alarmManager.setAndAllowWhileIdle(
                            AlarmManager.RTC_WAKEUP,
                            triggerAt,
                            pendingIntent
                        )
                    }
                } else {
                    alarmManager.set(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent)
                }
                Log.d(TAG, "Watchdog alarm scheduled in ${delayMillis / 1000}s.")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to schedule watchdog alarm", e)
            }
        }

        fun cancel(context: Context) {
            try {
                val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
                val intent = Intent(context, CampusConnectWatchdogReceiver::class.java).apply {
                    action = ACTION_WATCHDOG_HEARTBEAT
                }
                val pendingIntent = PendingIntent.getBroadcast(
                    context,
                    REQUEST_CODE,
                    intent,
                    PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
                )
                if (pendingIntent != null) {
                    alarmManager.cancel(pendingIntent)
                    pendingIntent.cancel()
                    Log.d(TAG, "Watchdog alarm cancelled.")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to cancel watchdog alarm", e)
            }
        }
    }

    override fun onReceive(context: Context, intent: Intent?) {
        Log.d(TAG, "Watchdog heartbeat received.")

        val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
        val wakeLock = pm?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "CampusConnect:WatchdogWakeLock")
        wakeLock?.acquire(15000) // Hold wakelock for max 15 seconds to execute network check

        val pendingResult = goAsync()

        executor.execute {
            try {
                val prefs = context.getSharedPreferences(CampusConnectCore.PREFS_NAME, Context.MODE_PRIVATE)
                val isEnabled = prefs.getBoolean(CampusConnectCore.KEY_ENABLED, false)
                val username = prefs.getString(CampusConnectCore.KEY_USERNAME, "")
                val password = prefs.getString(CampusConnectCore.KEY_PASSWORD, "")

                if (!isEnabled || username.isNullOrEmpty() || password.isNullOrEmpty()) {
                    Log.d(TAG, "Auto-login not enabled. Watchdog resting.")
                    return@execute
                }

                // 1. Check if the foreground service was killed by Android LMK or OEM cleaner
                if (!CampusConnectService.isServiceRunning()) {
                    Log.w(TAG, "Service is not running! Resurrecting CampusConnectService...")
                    try {
                        CampusConnectService.start(context)
                    } catch (e: Exception) {
                        Log.e(TAG, "Failed to resurrect CampusConnectService", e)
                    }
                }

                // 2. If connected to Wi-Fi, verify network state and authenticate if needed
                val wifiNetwork = CampusConnectCore.getWifiNetwork(context)
                if (wifiNetwork != null) {
                    Log.d(TAG, "Wi-Fi is connected during heartbeat. Verifying internet connectivity...")
                    CampusConnectCore.checkAndAuthenticate(context, "watchdog-heartbeat", wifiNetwork)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Watchdog execution error", e)
            } finally {
                // Reschedule the next heartbeat alarm (ensuring the cycle never dies)
                schedule(context, DEFAULT_INTERVAL_MS)
                try {
                    if (wakeLock?.isHeld == true) {
                        wakeLock.release()
                    }
                } catch (_: Exception) {}
                pendingResult.finish()
            }
        }
    }
}
