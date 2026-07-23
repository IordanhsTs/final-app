package expo.modules.vertexlocation

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.location.Location
import android.os.BatteryManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

class VertexLocationService : Service() {

  companion object {
    @Volatile var isRunning = false
    @Volatile private var instance: VertexLocationService? = null
    private const val CHANNEL_ID = "vertex_location_channel"
    private const val NOTIF_ID = 4321

    // Ενημέρωση token του ΖΩΝΤΑΝΟΥ service από τον JS client (μία αρχή αλήθειας:
    // ο JS είναι ο μόνος refresher και ταΐζει εδώ το φρέσκο token σε κάθε
    // TOKEN_REFRESHED). Έτσι σε κανονική χρήση το native ΔΕΝ κάνει το δικό του
    // refresh → δεν αποκλίνει η αλυσίδα refresh tokens → κανένα logout/παγωμένο
    // στίγμα. Το refreshAccessToken() παραμένει ΜΟΝΟ ως fallback για killed-app.
    fun pushToken(access: String?, refresh: String?) {
      val svc = instance ?: return
      if (!access.isNullOrEmpty()) svc.accessToken = access
      if (!refresh.isNullOrEmpty()) svc.refreshToken = refresh
    }
  }

  private lateinit var fused: FusedLocationProviderClient
  private var wakeLock: PowerManager.WakeLock? = null
  private val executor = Executors.newSingleThreadExecutor()

  private var driverId: String? = null
  private var supabaseUrl: String? = null
  private var anonKey: String? = null
  private var schema: String? = null   // MULTI-TENANT: co_* schema εταιρίας (null/'public' = default)
  @Volatile private var accessToken: String? = null
  @Volatile private var refreshToken: String? = null

  private val callback = object : LocationCallback() {
    override fun onLocationResult(result: LocationResult) {
      val loc = result.lastLocation ?: return
      executor.execute { sendLocation(loc) }
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent == null) { stopSelf(); return START_NOT_STICKY }

    driverId = intent.getStringExtra("driverId")
    supabaseUrl = intent.getStringExtra("supabaseUrl")?.trimEnd('/')
    anonKey = intent.getStringExtra("anonKey")
    accessToken = intent.getStringExtra("accessToken")
    refreshToken = intent.getStringExtra("refreshToken")
    schema = intent.getStringExtra("schema")
    val intervalMs = (intent.getStringExtra("intervalMs") ?: "10000").toLong()

    if (driverId == null || supabaseUrl == null || anonKey == null) {
      stopSelf(); return START_NOT_STICKY
    }

    createChannel()
    startAsForeground()
    acquireWakeLock()

    fused = LocationServices.getFusedLocationProviderClient(this)
    val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, intervalMs)
      .setMinUpdateIntervalMillis(intervalMs / 2)
      .setWaitForAccurateLocation(false)
      .build()

    try {
      fused.requestLocationUpdates(request, callback, mainLooper)
    } catch (e: SecurityException) {
      stopSelf(); return START_NOT_STICKY
    }

    instance = this
    isRunning = true
    return START_STICKY
  }

  private fun startAsForeground() {
    val smallIcon = applicationInfo.icon.takeIf { it != 0 }
      ?: android.R.drawable.ic_menu_mylocation

    val notification: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle("VERTEX — Σε βάρδια")
      .setContentText("Η τοποθεσία σας αποστέλλεται στο κέντρο.")
      .setSmallIcon(smallIcon)
      .setOngoing(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .build()

    when {
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE -> // API 34 (Android 14)
        startForeground(
          NOTIF_ID, notification,
          ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION or
            ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
        )
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ->
        startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
      else ->
        startForeground(NOTIF_ID, notification)
    }
  }

  private fun acquireWakeLock() {
    val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
    wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "vertex::LocationWakelock").apply {
      setReferenceCounted(false)
      acquire(12 * 60 * 60 * 1000L) // 12h ceiling — απελευθερώνεται στο onDestroy
    }
  }

  private fun createChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        CHANNEL_ID,
        "Παρακολούθηση τοποθεσίας",
        NotificationManager.IMPORTANCE_LOW
      ).apply { lockscreenVisibility = Notification.VISIBILITY_PUBLIC }
      (getSystemService(NotificationManager::class.java))?.createNotificationChannel(channel)
    }
  }

  // ── Δικτυακή αποστολή — τρέχει στο executor thread, εκτός JS bridge ──
  private fun sendLocation(loc: Location) {
    if (patchLocation(loc, accessToken)) return
    // 401 ή σφάλμα → δοκίμασε refresh του JWT και ξαναστείλε
    if (refreshAccessToken()) {
      patchLocation(loc, accessToken)
    }
  }

  private fun patchLocation(loc: Location, token: String?): Boolean {
    // Χωρίς έγκυρο access token ΔΕΝ γράφουμε ως anon: υπό RLS θα αποτύγχανε σιωπηλά, και
    // σε λάθος schema θα «μόλυνε» το public. Επιστρέφουμε false → ο caller δοκιμάζει refresh.
    if (token.isNullOrEmpty()) return false
    val url = "$supabaseUrl/rest/v1/drivers?id=eq.$driverId"
    var conn: HttpURLConnection? = null
    return try {
      conn = (URL(url).openConnection() as HttpURLConnection).apply {
        requestMethod = "PATCH"
        connectTimeout = 15000
        readTimeout = 15000
        doOutput = true
        setRequestProperty("Content-Type", "application/json")
        setRequestProperty("apikey", anonKey)
        setRequestProperty("Authorization", "Bearer $token")
        // MULTI-TENANT: γράψε στο schema της εταιρίας (co_*), όχι πάντα στο 'public'.
        // Content-Profile = schema εγγραφής στο PostgREST. Ο JS στέλνει πάντα schema
        // (fallback 'public'), οπότε είναι non-null· ο έλεγχος μένει για ασφάλεια.
        schema?.takeIf { it.isNotEmpty() }?.let {
          setRequestProperty("Content-Profile", it)
          setRequestProperty("Accept-Profile", it)
        }
        setRequestProperty("Prefer", "return=minimal")
      }
      val body = JSONObject()
        .put("latitude", loc.latitude)
        .put("longitude", loc.longitude)
      readBatteryLevel()?.let { body.put("battery_level", it) }
      OutputStreamWriter(conn.outputStream).use { it.write(body.toString()) }
      conn.responseCode in 200..299
    } catch (e: Exception) {
      false
    } finally {
      conn?.disconnect()
    }
  }

  private fun refreshAccessToken(): Boolean {
    val rt = refreshToken ?: return false
    val url = "$supabaseUrl/auth/v1/token?grant_type=refresh_token"
    var conn: HttpURLConnection? = null
    return try {
      conn = (URL(url).openConnection() as HttpURLConnection).apply {
        requestMethod = "POST"
        connectTimeout = 15000
        readTimeout = 15000
        doOutput = true
        setRequestProperty("Content-Type", "application/json")
        setRequestProperty("apikey", anonKey)
      }
      OutputStreamWriter(conn.outputStream).use {
        it.write(JSONObject().put("refresh_token", rt).toString())
      }
      if (conn.responseCode !in 200..299) return false
      val resp = conn.inputStream.bufferedReader().use { it.readText() }
      val json = JSONObject(resp)
      accessToken = json.optString("access_token", accessToken ?: "")
      refreshToken = json.optString("refresh_token", refreshToken ?: "")
      true
    } catch (e: Exception) {
      false
    } finally {
      conn?.disconnect()
    }
  }

  // Ποσοστό μπαταρίας (0–100) — καμία άδεια, μία κλήση. null αν δεν είναι διαθέσιμο.
  // Στέλνεται μαζί με το location update ώστε ο admin να βλέπει μπαταρία διανομέων.
  private fun readBatteryLevel(): Int? {
    return try {
      val bm = getSystemService(Context.BATTERY_SERVICE) as BatteryManager
      val level = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
      if (level in 0..100) level else null
    } catch (e: Exception) {
      null
    }
  }

  override fun onDestroy() {
    super.onDestroy()
    isRunning = false
    instance = null
    try { if (::fused.isInitialized) fused.removeLocationUpdates(callback) } catch (_: Exception) {}
    wakeLock?.let { if (it.isHeld) it.release() }
    executor.shutdown()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      @Suppress("DEPRECATION") stopForeground(true)
    }
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    // Συνεχίζει να τρέχει όταν ο χρήστης κλείνει το app από τα recents.
    super.onTaskRemoved(rootIntent)
  }
}
