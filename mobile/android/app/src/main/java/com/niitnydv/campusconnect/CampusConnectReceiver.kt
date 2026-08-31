package com.niitnydv.campusconnect

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import java.util.concurrent.Executors

class CampusConnectReceiver : BroadcastReceiver() {
    companion object {
        private const val TAG = "CampusConnectReceiver"
        private val executor = Executors.newSingleThreadExecutor()
    }

    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return
        Log.d(TAG, "CampusConnectReceiver triggered by action: $action")

        val pendingResult = goAsync()
        executor.execute {
            try {
                CampusConnectCore.checkAndAuthenticate(context, action)
            } catch (e: Exception) {
                Log.e(TAG, "Error in receiver execution", e)
            } finally {
                pendingResult.finish()
            }
        }
    }
}
