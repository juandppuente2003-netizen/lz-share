package com.lzplus.tv;

import android.app.Activity;
import android.graphics.Color;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.webkit.WebView;
import android.widget.FrameLayout;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.exoplayer.source.MediaSource;
import androidx.media3.ui.AspectRatioFrameLayout;
import androidx.media3.ui.PlayerView;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.HashMap;
import java.util.Map;

/**
 * TV en vivo dentro de la vista previa: el reproductor de la app va DETRÁS de la página
 * (el WebView es transparente en ese hueco), así los textos de la app se ven encima del video.
 * Prueba las señales en orden: si una falla o no arranca en 12 s, pasa a la siguiente.
 * Avisa a la página con window.lzInline(estado, opción): trying, playing, buffering, fail.
 */
class InlinePlayer {
    private static final String VLC_UA = "VLC/3.0.20 LibVLC/3.0.20";
    private final Activity act;
    private final FrameLayout root;
    private final WebView web;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private PlayerView view;
    private ExoPlayer player;
    private JSONArray opts = new JSONArray();
    private int index = 0;
    private long optAt = 0;
    boolean active = false;

    private final Runnable watchdog = new Runnable() {
        public void run() {
            if (player == null || !active) return;
            if (player.isPlaying()) return;
            if (System.currentTimeMillis() - optAt >= 12000) next();
            else handler.postDelayed(this, 1000);
        }
    };

    InlinePlayer(Activity act, FrameLayout root, WebView web) { this.act = act; this.root = root; this.web = web; }

    private void ensure() {
        if (player != null) return;
        view = new PlayerView(act);
        view.setUseController(false);
        view.setFocusable(false);
        view.setFocusableInTouchMode(false);
        view.setShutterBackgroundColor(Color.BLACK);
        view.setBackgroundColor(Color.BLACK);
        view.setResizeMode(AspectRatioFrameLayout.RESIZE_MODE_FIT);
        view.setVisibility(View.INVISIBLE);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(1, 1, Gravity.TOP | Gravity.START);
        root.addView(view, 0, lp);   // índice 0: detrás del WebView
        DefaultRenderersFactory renderers = new DefaultRenderersFactory(act)
                .setEnableDecoderFallback(true)
                .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_PREFER);
        player = new ExoPlayer.Builder(act, renderers).build();
        view.setPlayer(player);
        player.addListener(new Player.Listener() {
            @Override
            public void onPlayerError(PlaybackException error) { if (active) next(); }

            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                if (isPlaying && active) { handler.removeCallbacks(watchdog); js("playing"); }
            }

            @Override
            public void onPlaybackStateChanged(int state) {
                if (!active) return;
                if (state == Player.STATE_BUFFERING) js("buffering");
                else if (state == Player.STATE_ENDED) next();   // la señal se cortó: siguiente opción
            }
        });
    }

    /** json: {"opts": [{"url": "...", "ref": "...", "ua": "..."}]} */
    void play(String json) {
        try { JSONObject d = new JSONObject(json); JSONArray o = d.optJSONArray("opts"); opts = o != null ? o : new JSONArray(); }
        catch (Exception e) { opts = new JSONArray(); }
        ensure();
        active = true;
        playIndex(0);
    }

    private void playIndex(int i) {
        handler.removeCallbacks(watchdog);
        index = i;
        if (index >= opts.length()) { player.stop(); js("fail"); return; }
        JSONObject o = opts.optJSONObject(index);
        if (o == null) { playIndex(index + 1); return; }
        String url = o.optString("url", ""), ua = o.optString("ua", ""), ref = o.optString("ref", "");
        if (url.length() == 0) { playIndex(index + 1); return; }
        DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
                .setUserAgent(ua.length() > 0 ? ua : VLC_UA)
                .setAllowCrossProtocolRedirects(true)
                .setConnectTimeoutMs(8000)
                .setReadTimeoutMs(15000);
        if (ref.length() > 0) {
            Map<String, String> h = new HashMap<>();
            h.put("Referer", ref);
            http.setDefaultRequestProperties(h);
        }
        MediaItem.Builder b = new MediaItem.Builder().setUri(Uri.parse(url));
        String lower = url.toLowerCase();
        if (lower.contains(".m3u8") || lower.contains("m3u8")) b.setMimeType(MimeTypes.APPLICATION_M3U8);
        else if (lower.contains(".mpd")) b.setMimeType(MimeTypes.APPLICATION_MPD);
        MediaSource source = new DefaultMediaSourceFactory(http).createMediaSource(b.build());
        player.setMediaSource(source);
        player.prepare();
        player.setPlayWhenReady(true);
        optAt = System.currentTimeMillis();
        js("trying");
        handler.postDelayed(watchdog, 1000);
    }

    private void next() { if (active) playIndex(index + 1); }

    /** Lugar del video en pantalla (en pixeles reales). Ancho o alto 0 = esconderlo (el sonido sigue). */
    void rect(int x, int y, int w, int h) {
        if (view == null) return;
        if (w <= 0 || h <= 0) { view.setVisibility(View.INVISIBLE); return; }
        // nunca más grande que la pantalla
        int W = root.getWidth(), H = root.getHeight();
        if (W > 0 && H > 0) { x = Math.max(0, Math.min(x, W)); y = Math.max(0, Math.min(y, H)); w = Math.min(w, W - x); h = Math.min(h, H - y); }
        FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) view.getLayoutParams();
        lp.width = w; lp.height = h; lp.leftMargin = x; lp.topMargin = y; lp.gravity = Gravity.TOP | Gravity.START;
        view.setLayoutParams(lp);
        if (view.getVisibility() != View.VISIBLE) view.setVisibility(View.VISIBLE);
    }

    void stop() {
        active = false;
        handler.removeCallbacks(watchdog);
        if (player != null) { player.stop(); player.clearMediaItems(); }
        if (view != null) view.setVisibility(View.INVISIBLE);
    }

    void release() {
        stop();
        if (player != null) { player.release(); player = null; }
        if (view != null) { root.removeView(view); view = null; }
    }

    private void js(String state) {
        web.evaluateJavascript("window.lzInline && lzInline('" + state + "'," + index + ")", null);
    }
}
