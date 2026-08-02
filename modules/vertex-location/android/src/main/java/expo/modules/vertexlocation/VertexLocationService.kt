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

    // ── Κατώφλια χιλιομετρητή (ίδια με το migration 0013) ──
    // Ελάχιστη μετατόπιση για να μετρήσει ένα στίγμα. Στα 10 δευτερόλεπτα ανά
    // στίγμα, 20 m ≈ 7 km/h: ο θόρυβος του GPS πεθαίνει, ενώ το περπάτημα
    // μέχρι την πόρτα του πελάτη δεν καίει βενζίνη ούτως ή άλλως.
    private const val MIN_MOVE_M = 20.0
    // Στίγμα με χειρότερη ακρίβεια από αυτή δεν είναι αξιόπιστο ούτε ως άγκυρα.
    private const val MAX_ACCURACY_M = 25.0f
    // Κάτω από ~5 km/h ο διανομέας δεν κινείται με τη μηχανή.
    private const val MIN_SPEED_MS = 1.4f
    // Πάνω από ~151 km/h δεν είναι μηχανή — είναι αλλαγή κεραίας ή κακό στίγμα.
    private const val MAX_SPEED_MS = 42.0
    // Κενό στη ροή στιγμάτων: δεν ενώνουμε τα δύο σημεία με ευθεία γραμμή.
    private const val MAX_GAP_S = 300.0

    private const val PREFS = "vertex_odometer"
    private const val KEY_PENDING = "pending_m"
    private const val KEY_INFLIGHT = "inflight_m"
    private const val KEY_INFLIGHT_SEQ = "inflight_seq"
    private const val KEY_SEQ = "seq"

    // Ενημέρωση token του ΖΩΝΤΑΝΟΥ service από τον JS client (μία αρχή αλήθειας:
    // ο JS είναι ο μόνος refresher και ταΐζει εδώ το φρέσκο token σε κάθε
    // TOKEN_REFRESHED). Έτσι σε κανονική χρήση το native ΔΕΝ κάνει το δικό του
    // refresh → δεν αποκλίνει η αλυσίδα refresh tokens → κανένα logout/παγωμένο
    // στίγμα. Το refreshAccessToken() παραμένει ΜΟΝΟ ως fallback για killed-app.
    fun pushToken(access: String?, refresh: String?) {
      val svc = instance ?: return
      if (!access.isNullOrEmpty()) svc.accessToken = access
      if (!refresh.isNullOrEmpty()) svc.refreshToken = refresh
      VertexAuthStore.save(svc, access, refresh)
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

  // ── ΧΙΛΙΟΜΕΤΡΗΤΗΣ ΒΑΡΔΙΑΣ ────────────────────────────────────────────────
  // Μετράμε ΕΔΩ και όχι μόνο στον server, για δύο λόγους: (1) εδώ υπάρχουν το
  // `accuracy` και το `speed` του στίγματος — το speed έρχεται από Doppler και
  // είναι πολύ πιο αξιόπιστο από τη διαφορά δύο θέσεων· (2) όταν πέφτει το
  // δίκτυο, η μέτρηση συνεχίζεται τοπικά και στέλνεται μόλις επανέλθει.
  //
  // Στέλνουμε ΔΙΑΦΟΡΕΣ μέτρων (όχι σύνολο) με αύξοντα αριθμό. Βλ. migration
  // 0013 για το γιατί: ο server μπορεί να κόψει τη βάρδια στα δύο όσο εμείς
  // είμαστε offline, και ένα σωρευτικό νούμερο θα μετριόταν δύο φορές.
  private var lastFix: Location? = null
  private var pendingMeters: Double = 0.0    // μαζεμένα, δεν στάλθηκαν ακόμα
  private var inFlightMeters: Double = 0.0   // στάλθηκαν, δεν επιβεβαιώθηκαν
  private var inFlightSeq: Long = 0
  private var pingSeq: Long = 0
  private var deviceSession: String = ""

  private val callback = object : LocationCallback() {
    override fun onLocationResult(result: LocationResult) {
      val loc = result.lastLocation ?: return
      executor.execute {
        accumulateDistance(loc)
        sendLocation(loc)
      }
    }
  }

  // Πόσα μέτρα προσθέτει αυτό το στίγμα. Όλα τα κατώφλια είναι τα ίδια με του
  // server (migration 0013) ώστε τα δύο μονοπάτια να μη δίνουν άλλο νούμερο.
  private fun accumulateDistance(loc: Location) {
    val prev = lastFix

    // Κακό στίγμα: δεν το εμπιστευόμαστε ούτε ως άγκυρα για το επόμενο.
    if (loc.hasAccuracy() && loc.accuracy > MAX_ACCURACY_M) return

    if (prev == null) { lastFix = loc; return }

    val dt = (loc.time - prev.time) / 1000.0
    // Κενό κάλυψης: δεν ξέρουμε τι έγινε ενδιάμεσα → νέο τμήμα, μηδέν χρέωση.
    if (dt <= 0 || dt > MAX_GAP_S) { lastFix = loc; return }

    // ΣΤΑΣΗ: το Doppler speed είναι η πιο αξιόπιστη ένδειξη ακινησίας. Κρατάμε
    // την άγκυρα ώστε αργή αλλά πραγματική κίνηση να συσσωρευτεί και να μετρηθεί.
    if (loc.hasSpeed() && loc.speed < MIN_SPEED_MS) return

    val d = prev.distanceTo(loc).toDouble()

    // ΘΟΡΥΒΟΣ: κάτω από το κατώφλι κίνησης — η άγκυρα ΔΕΝ μετακινείται.
    if (d < MIN_MOVE_M) return

    // ΤΗΛΕΜΕΤΑΦΟΡΑ: αδύνατη ταχύτητα → κακό στίγμα, κρατάμε την παλιά άγκυρα.
    if (d / dt > MAX_SPEED_MS) return

    pendingMeters += d
    lastFix = loc
    persistOdometer()
  }

  // Ο χιλιομετρητής επιβιώνει σε restart του service (START_STICKY) και σε
  // θάνατο της εφαρμογής — αλλιώς κάθε kill θα έσβηνε αμέτρητα χιλιόμετρα.
  private fun persistOdometer() {
    try {
      getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
        .putFloat(KEY_PENDING, pendingMeters.toFloat())
        .putFloat(KEY_INFLIGHT, inFlightMeters.toFloat())
        .putLong(KEY_INFLIGHT_SEQ, inFlightSeq)
        .putLong(KEY_SEQ, pingSeq)
        .apply()
    } catch (_: Exception) {}
  }

  private fun restoreOdometer() {
    try {
      val p = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      pendingMeters  = p.getFloat(KEY_PENDING, 0f).toDouble()
      inFlightMeters = p.getFloat(KEY_INFLIGHT, 0f).toDouble()
      inFlightSeq    = p.getLong(KEY_INFLIGHT_SEQ, 0L)
      pingSeq        = p.getLong(KEY_SEQ, 0L)
    } catch (_: Exception) {}
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

    // Ό,τι μας δίνει ο JS στην εκκίνηση είναι η νέα βάση της αλυσίδας tokens.
    VertexAuthStore.save(this, accessToken, refreshToken)

    // Νέα συνεδρία χιλιομετρητή σε κάθε εκκίνηση: ο server τη χρησιμοποιεί για
    // να δεχτεί αρίθμηση που ξαναρχίζει από το 1 μετά από restart. Τα μέτρα που
    // δεν πρόλαβαν να σταλούν επιβιώνουν (restoreOdometer) και φεύγουν τώρα.
    deviceSession = java.util.UUID.randomUUID().toString()
    lastFix = null
    restoreOdometer()

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
    // Ετοιμάζουμε το πακέτο μέτρων ΠΡΙΝ την αποστολή. Αν η προηγούμενη
    // απόπειρα απέτυχε, ξαναστέλνουμε το ΙΔΙΟ πακέτο με τον ΙΔΙΟ αύξοντα
    // αριθμό: αν τελικά είχε γραφτεί και χάθηκε μόνο η απάντηση, ο server το
    // απορρίπτει ως διπλό. Προτιμούμε να χάσουμε μερικά μέτρα παρά να
    // χρεώσουμε βενζίνη δύο φορές.
    if (inFlightMeters <= 0.0 && pendingMeters > 0.0) {
      pingSeq += 1
      inFlightSeq = pingSeq
      inFlightMeters = pendingMeters
      pendingMeters = 0.0
      persistOdometer()
    }

    val sent = patchLocation(loc, accessToken)
      // 401 ή σφάλμα → δοκίμασε refresh του JWT και ξαναστείλε
      || (refreshAccessToken() && patchLocation(loc, accessToken))

    if (sent && inFlightMeters > 0.0) {
      inFlightMeters = 0.0
      persistOdometer()
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
      // Ο χιλιομετρητής ταξιδεύει μαζί με το στίγμα — καμία επιπλέον κλήση.
      // Στέλνεται μόνο όταν υπάρχουν μέτρα να αναφερθούν· έτσι τα στίγματα σε
      // στάση μένουν ακριβώς όσο ελαφριά ήταν πριν.
      if (inFlightMeters > 0.0) {
        body.put("device_distance_m", inFlightMeters)
        body.put("device_session", deviceSession)
        body.put("device_ping_seq", inFlightSeq)
      }
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
      // ΚΡΙΣΙΜΟ: το rotation μόλις ακύρωσε ό,τι κρατά ο JS στον δίσκο. Αν δεν
      // γραφτεί ΕΔΩ το νέο ζευγάρι, η εφαρμογή θα ξυπνήσει με άκυρο token και
      // θα πετάξει τον διανομέα έξω. Βλ. VertexAuthStore.
      VertexAuthStore.save(this, accessToken, refreshToken)
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
    // Ό,τι μετρήθηκε και δεν πρόλαβε να σταλεί περιμένει στον δίσκο για την
    // επόμενη εκκίνηση — δεν πετάμε χιλιόμετρα επειδή έκλεισε το service.
    persistOdometer()
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
