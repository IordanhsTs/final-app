package expo.modules.vertexlocation

import android.content.Context

// ════════════════════════════════════════════════════════════════════════════
// ΜΟΝΙΜΗ ΑΠΟΘΗΚΗ TOKEN — Η ΓΕΦΥΡΑ ΠΡΟΣ ΤΟΝ JS
//
// Το service κρατούσε τα tokens ΜΟΝΟ στη μνήμη. Όταν το Android σκότωνε τη
// διεργασία JS και το foreground service συνέχιζε μόνο του, κάθε ώρα ανανέωνε
// το token (rotation → το προηγούμενο ΑΚΥΡΩΝΕΤΑΙ) και το κρατούσε για πάρτη
// του. Ο JS ξυπνούσε αργότερα με ένα token δεκάδες rotations πίσω, το Supabase
// απαντούσε «Already Used», το supabase-js έσβηνε το session — και ο διανομέας
// έβρισκε οθόνη εισόδου χωρίς να έχει πατήσει τίποτα.
//
// Εδώ γράφεται ΚΑΘΕ έκδοση των tokens, σε SharedPreferences: επιβιώνει του
// θανάτου του service ΚΑΙ της εφαρμογής. Ο JS τα διαβάζει μόλις σηκωθεί
// (sessionStore.js) και υιοθετεί ό,τι είναι νεότερο από το δικό του.
// ════════════════════════════════════════════════════════════════════════════
object VertexAuthStore {

  private const val PREFS = "vertex_auth"
  private const val KEY_ACCESS = "access_token"
  private const val KEY_REFRESH = "refresh_token"

  // Γράφει μόνο ό,τι είναι μη κενό: μια κλήση με μισά στοιχεία δεν πρέπει να
  // σβήνει το άλλο μισό. Το σβήσιμο γίνεται ρητά, μέσω clear().
  fun save(ctx: Context, access: String?, refresh: String?) {
    try {
      val editor = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      if (!access.isNullOrEmpty()) editor.putString(KEY_ACCESS, access)
      if (!refresh.isNullOrEmpty()) editor.putString(KEY_REFRESH, refresh)
      editor.apply()
    } catch (_: Exception) {}
  }

  fun read(ctx: Context): Map<String, String> {
    return try {
      val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      mapOf(
        "accessToken" to (prefs.getString(KEY_ACCESS, "") ?: ""),
        "refreshToken" to (prefs.getString(KEY_REFRESH, "") ?: "")
      )
    } catch (_: Exception) {
      mapOf("accessToken" to "", "refreshToken" to "")
    }
  }

  // ΜΟΝΟ σε ηθελημένη αποσύνδεση. Αλλιώς ένα ξεχασμένο token θα «ανάσταινε» τη
  // σύνδεση του προηγούμενου διανομέα στο επόμενο άνοιγμα της εφαρμογής.
  fun clear(ctx: Context) {
    try {
      ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
        .remove(KEY_ACCESS)
        .remove(KEY_REFRESH)
        .apply()
    } catch (_: Exception) {}
  }
}
