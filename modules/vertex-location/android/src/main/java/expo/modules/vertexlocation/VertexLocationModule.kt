package expo.modules.vertexlocation

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class VertexLocationModule : Module() {

  private val context: Context
    get() = appContext.reactContext ?: throw Exception("React context unavailable")

  override fun definition() = ModuleDefinition {
    Name("VertexLocation")

    Function("startTracking") { config: Map<String, String> ->
      val intent = Intent(context, VertexLocationService::class.java).apply {
        putExtra("driverId", config["driverId"])
        putExtra("supabaseUrl", config["supabaseUrl"])
        putExtra("anonKey", config["anonKey"])
        putExtra("accessToken", config["accessToken"])
        putExtra("refreshToken", config["refreshToken"])
        putExtra("intervalMs", config["intervalMs"] ?: "10000")
        putExtra("schema", config["schema"])  // MULTI-TENANT: schema εταιρίας για τα REST writes
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    // Ταΐζει το ζωντανό service με φρέσκο token από τον JS client (χωρίς restart —
    // δεν αγγίζει location/foreground/wakelock). Η αποθήκευση γίνεται ΚΑΙ όταν δεν
    // τρέχει service: η μόνιμη αποθήκη είναι η κοινή αλήθεια των δύο κόσμων.
    Function("updateToken") { config: Map<String, String> ->
      VertexAuthStore.save(context, config["accessToken"], config["refreshToken"])
      VertexLocationService.pushToken(config["accessToken"], config["refreshToken"])
    }

    // Τα τελευταία γνωστά tokens — διαβάζονται και με ΝΕΚΡΟ service (SharedPreferences).
    // Ο JS τα υιοθετεί στην εκκίνηση αν είναι νεότερα από τα δικά του (sessionStore.js).
    Function("getTokens") {
      VertexAuthStore.read(context)
    }

    // Μόνο σε ηθελημένη αποσύνδεση (διανομέας, admin, άλλη συσκευή).
    Function("clearTokens") {
      VertexAuthStore.clear(context)
    }

    Function("stopTracking") {
      context.stopService(Intent(context, VertexLocationService::class.java))
    }

    Function("isTracking") {
      VertexLocationService.isRunning
    }

    Function("isIgnoringBatteryOptimizations") {
      val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      pm.isIgnoringBatteryOptimizations(context.packageName)
    }

    // Εμφανίζει το system dialog "Να επιτρέπεται η δραστηριότητα στο παρασκήνιο" (one-tap)
    Function("requestBatteryOptExemption") {
      val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
        data = Uri.parse("package:${context.packageName}")
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      context.startActivity(intent)
    }

    // Fallback: άνοιγμα της σελίδας ρυθμίσεων της εφαρμογής
    Function("openAppSettings") {
      val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
        data = Uri.parse("package:${context.packageName}")
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      context.startActivity(intent)
    }
  }
}
