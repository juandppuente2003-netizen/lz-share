package com.lzplus.tv;

import android.app.Activity;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.widget.Toast;

import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.Tracks;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.exoplayer.source.MediaSource;
import androidx.media3.ui.PlayerView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

/**
 * Reproductor nativo (Media3 / ExoPlayer): abre MKV, HEVC, AC3 y casi cualquier formato.
 * Recibe varias opciones y, si una falla o no arranca, pasa sola a la siguiente.
 */
public class PlayerActivity extends Activity {
    private static final String VLC_UA = "VLC/3.0.20 LibVLC/3.0.20";
    private static final long START_TIMEOUT_MS = 15000;

    private ExoPlayer player;
    private PlayerView view;
    private JSONArray opts = new JSONArray();
    // Subtítulos automáticos: si el audio que suena es español/latino no se muestran; si es otro idioma, sí
    private boolean subDecided = false, optEs = false;
    private int index = 0;
    private String sub, subLang;
    private long startMs = 0;
    private String audioLang = "es";
    private boolean failedAll = false;
    private boolean isEp = false, ended = false, introSkipped = false, slept = false, wantPick = false;
    private long sleepAt = 0, lastBack = 0, openedAt = System.currentTimeMillis(), tookMs = -1, optAt = 0;
    private TextView skip;
    private final Runnable introCheck = new Runnable() {
        public void run() {
            if (player == null) return;
            if (sleepAt > 0 && System.currentTimeMillis() > sleepAt) { slept = true; finish(); return; }   // temporizador para dormir
            long p = player.getCurrentPosition();
            boolean show = isEp && !introSkipped && player.isPlaying() && p > 10000 && p < 240000 && startMs < 60000;
            skip.setVisibility(show ? android.view.View.VISIBLE : android.view.View.GONE);
            handler.postDelayed(this, 1000);
        }
    };
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable startWatchdog = new Runnable() {
        public void run() {
            if (player == null || player.isPlaying() || player.getPlaybackState() == Player.STATE_READY) return;
            long el = System.currentTimeMillis() - optAt;
            long got = player.getTotalBufferedDuration();
            if ((el >= (startMs > 0 ? 12000 : 7000) && got < 300) || el >= 20000) { next(got < 300 ? "no responde" : "muy lento"); return; }
            handler.postDelayed(this, 1000);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON | WindowManager.LayoutParams.FLAG_FULLSCREEN);
        try {
            JSONObject d = new JSONObject(getIntent().getStringExtra("data"));
            opts = d.optJSONArray("opts");
            if (opts == null) opts = new JSONArray();
            sub = d.optString("sub", null);
            subLang = d.optString("subLang", null);
            startMs = d.optLong("start", 0) * 1000L;
            audioLang = d.optString("audioLang", "es");
            setTitle(d.optString("title", "LZ-SHARE"));
            isEp = d.optBoolean("ep", false);
            sleepAt = d.optLong("sleepAt", 0);
        } catch (Exception e) { opts = new JSONArray(); }

        view = new PlayerView(this);
        view.setKeepScreenOn(true);
        view.setShowSubtitleButton(true);
        view.setControllerShowTimeoutMs(4000);
        FrameLayout root = new FrameLayout(this);
        root.addView(view);
        skip = new TextView(this);
        skip.setText("OK  ·  Saltar intro  ⏭");
        skip.setTextColor(Color.parseColor("#111111"));
        skip.setTextSize(18);
        skip.setPadding(36, 18, 36, 18);
        GradientDrawable bg = new GradientDrawable(); bg.setColor(Color.parseColor("#F5B84B")); bg.setCornerRadius(60);
        skip.setBackground(bg);
        skip.setVisibility(android.view.View.GONE);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM | Gravity.END);
        lp.setMargins(0, 0, 64, 120);
        root.addView(skip, lp);
        setContentView(root);

        DefaultRenderersFactory renderers = new DefaultRenderersFactory(this)
                .setEnableDecoderFallback(true)
                .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_PREFER);
        player = new ExoPlayer.Builder(this, renderers).build();
        view.setPlayer(player);
        // Audio en español si la película lo trae (o el idioma original si así lo elegiste)
        androidx.media3.common.TrackSelectionParameters.Builder tsp = player.getTrackSelectionParameters().buildUpon();
        if (audioLang != null && audioLang.length() > 0) tsp.setPreferredAudioLanguages("es", "es-419", "es-MX", "spa", "lat");
        if (subLang != null && subLang.length() > 0) tsp.setPreferredTextLanguage(subLang);
        player.setTrackSelectionParameters(tsp.build());
        player.addListener(new Player.Listener() {
            @Override
            public void onPlayerError(PlaybackException error) { next(error.getErrorCodeName()); }

            @Override
            public void onIsPlayingChanged(boolean isPlaying) { if (isPlaying) { handler.removeCallbacks(startWatchdog); if (tookMs < 0) tookMs = System.currentTimeMillis() - openedAt; } }

            @Override
            public void onPlaybackStateChanged(int state) {
                if (state == Player.STATE_ENDED && !ended) { ended = true; finish(); }   // terminó: la app ofrece el siguiente episodio
            }

            @Override
            public void onTracksChanged(Tracks tracks) {
                if (subDecided || !autoSubs()) return;
                for (Tracks.Group g : tracks.getGroups()) {
                    if (g.getType() != C.TRACK_TYPE_AUDIO || !g.isSelected()) continue;
                    for (int k = 0; k < g.length; k++) {
                        if (!g.isTrackSelected(k)) continue;
                        String l = g.getTrackFormat(k).language;
                        boolean es = optEs || (l != null && l.toLowerCase().matches("^(es|spa|lat|la)([-_].*)?$"));
                        subDecided = true;
                        setSubsOn(!es);
                        return;
                    }
                }
            }
        });
        view.requestFocus();
        playIndex(0);
        handler.postDelayed(introCheck, 1000);
        Toast.makeText(this, "Botón ≡ o mantén OK: cambiar idioma o calidad", Toast.LENGTH_LONG).show();
    }

    private boolean autoSubs() { return sub != null && sub.length() > 0 && subLang != null && (subLang.startsWith("es") || subLang.startsWith("spa")); }
    private void setSubsOn(boolean on) {
        player.setTrackSelectionParameters(player.getTrackSelectionParameters().buildUpon().setTrackTypeDisabled(C.TRACK_TYPE_TEXT, !on).build());
    }

    private void playIndex(int i) {
        handler.removeCallbacks(startWatchdog);
        index = i;
        if (index >= opts.length()) {
            failedAll = opts.length() > 0;
            android.content.Intent r = new android.content.Intent();   // avisar antes de cerrar
            r.putExtra("failed", failedAll);
            setResult(RESULT_OK, r);
            Toast.makeText(this, opts.length() == 0 ? "No hay video para reproducir" : "Ninguna opción se pudo reproducir", Toast.LENGTH_LONG).show();
            finish();
            return;
        }
        JSONObject o = opts.optJSONObject(index);
        if (o == null) { playIndex(index + 1); return; }
        String url = o.optString("url", "");
        String ua = o.optString("ua", "");
        String ref = o.optString("ref", "");
        optEs = o.optBoolean("es", false);
        subDecided = false;
        if (autoSubs()) setSubsOn(!optEs);   // decisión inicial con la etiqueta de la opción; se confirma con el audio real

        DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
                .setUserAgent(ua.length() > 0 ? ua : VLC_UA)
                .setAllowCrossProtocolRedirects(true)
                .setConnectTimeoutMs(10000)
                .setReadTimeoutMs(20000);
        if (ref.length() > 0) {
            Map<String, String> h = new HashMap<>();
            h.put("Referer", ref);
            http.setDefaultRequestProperties(h);
        }

        MediaItem.Builder b = new MediaItem.Builder().setUri(Uri.parse(url));
        String lower = url.toLowerCase();
        if (lower.contains(".m3u8")) b.setMimeType(MimeTypes.APPLICATION_M3U8);
        else if (lower.contains(".mpd")) b.setMimeType(MimeTypes.APPLICATION_MPD);
        if (sub != null && sub.length() > 0) {
            String mime = sub.toLowerCase().contains(".vtt") ? MimeTypes.TEXT_VTT : MimeTypes.APPLICATION_SUBRIP;
            MediaItem.SubtitleConfiguration sc = new MediaItem.SubtitleConfiguration.Builder(Uri.parse(sub))
                    .setMimeType(mime).setLanguage(subLang).setSelectionFlags(C.SELECTION_FLAG_DEFAULT).build();
            b.setSubtitleConfigurations(Collections.singletonList(sc));
        }
        MediaSource source = new DefaultMediaSourceFactory(http).createMediaSource(b.build());
        player.setMediaSource(source);
        if (startMs > 0) player.seekTo(startMs);   // continuar donde te quedaste
        player.prepare();
        player.setPlayWhenReady(true);
        if (opts.length() > 1) Toast.makeText(this, "Opción " + (index + 1) + " de " + opts.length(), Toast.LENGTH_SHORT).show();
        optAt = System.currentTimeMillis();
        handler.postDelayed(startWatchdog, 3000);
    }

    private void next(String why) {
        if (isFinishing()) return;
        playIndex(index + 1);
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        // OK mientras se ve "Saltar intro": adelanta 85 segundos
        int k = e.getKeyCode();
        // Regresar: si están los controles, primero se esconden; para salir hay que presionarlo dos veces
        if (k == KeyEvent.KEYCODE_BACK || k == KeyEvent.KEYCODE_ESCAPE) {
            if (e.getAction() != KeyEvent.ACTION_UP) return true;
            if (view.isControllerFullyVisible()) { view.hideController(); return true; }
            if (player != null && player.getCurrentPosition() > 3000 && System.currentTimeMillis() - lastBack > 3000) {
                lastBack = System.currentTimeMillis();
                Toast.makeText(this, "Presiona Regresar otra vez para salir", Toast.LENGTH_SHORT).show();
                return true;
            }
            finish();
            return true;
        }
        // Botón Menú (≡) o mantener OK: volver a la lista de idioma y calidad
        boolean longOk = (k == KeyEvent.KEYCODE_DPAD_CENTER || k == KeyEvent.KEYCODE_ENTER) && e.getAction() == KeyEvent.ACTION_DOWN && e.getRepeatCount() == 8;
        if (k == KeyEvent.KEYCODE_MENU || k == KeyEvent.KEYCODE_SETTINGS || k == KeyEvent.KEYCODE_INFO || longOk) {
            if (e.getAction() == KeyEvent.ACTION_DOWN && (longOk || e.getRepeatCount() == 0)) { wantPick = true; finish(); }
            return true;
        }
        if (skip.getVisibility() == android.view.View.VISIBLE && !view.isControllerFullyVisible()
                && (k == KeyEvent.KEYCODE_DPAD_CENTER || k == KeyEvent.KEYCODE_ENTER)) {
            if (e.getAction() == KeyEvent.ACTION_UP && player != null) {
                introSkipped = true; skip.setVisibility(android.view.View.GONE);
                player.seekTo(player.getCurrentPosition() + 85000);
                Toast.makeText(this, "Intro saltada", Toast.LENGTH_SHORT).show();
            }
            return true;
        }
        return super.dispatchKeyEvent(e);
    }

    private void putResult() {
        // Avisa a la app hasta dónde se vio (para "Continuar viendo" y el siguiente episodio)
        if (player == null || failedAll) return;
        android.content.Intent r = new android.content.Intent();
        long d = player.getDuration();
        r.putExtra("dur", d > 0 ? d / 1000 : 0);
        r.putExtra("pos", ended && d > 0 ? d / 1000 : Math.max(0, player.getCurrentPosition() / 1000));
        r.putExtra("ended", ended);
        r.putExtra("sleep", slept);
        r.putExtra("pick", wantPick);
        r.putExtra("idx", index);
        r.putExtra("startMs", tookMs);   // qué opción se estaba viendo (para reanudar directo con ella)
        r.putExtra("failed", false);
        setResult(RESULT_OK, r);
    }

    @Override
    public void finish() { putResult(); super.finish(); }

    @Override
    protected void onPause() { super.onPause(); putResult(); }

    @Override
    protected void onStop() {
        super.onStop();
        handler.removeCallbacks(startWatchdog);
        handler.removeCallbacks(introCheck);
        if (player != null) { putResult(); player.release(); player = null; }
        finish();
    }
}
