package com.niitnydv.campusconnect

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

class CampusConnectBootReceiver : BroadcastReceiver() {
    companion object {
        private const val TAG = "CampusConnectBoot"
    }

    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return
        Log.i(TAG, "CampusConnectBootReceiver received intent: $action")

        val prefs = context.getSharedPreferences(CampusConnectCore.PREFS_NAME, Context.MODE_PRIVATE)
        val isEnabled = prefs.getBoolean(CampusConnectCore.KEY_ENABLED, false)
        val username = prefs.getString(CampusConnectCore.KEY_USERNAME, "")
        val password = prefs.getString(CampusConnectCore.KEY_PASSWORD, "")

        if (isEnabled && !username.isNullOrEmpty() && !password.isNullOrEmpty()) {
            Log.i(TAG, "Auto-start enabled with saved credentials. Launching CampusConnectService on boot/update...")
            try {
                CampusConnectService.start(context)
                CampusConnectWatchdogReceiver.schedule(context, 10000)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to start service on boot", e)
            }
        } else {
            Log.d(TAG, "CampusConnect is not registered or disabled; skipping boot start.")
        }
    }
}
