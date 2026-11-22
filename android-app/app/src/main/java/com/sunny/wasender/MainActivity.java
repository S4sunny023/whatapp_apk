package com.sunny.wasender;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ProgressBar;

public class MainActivity extends Activity {
    private WebView web;
    private ProgressBar bar;
    private SharedPreferences prefs;
    private String baseUrl;
    private boolean dialogOpen = false;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().setStatusBarColor(Color.parseColor("#0b1f1a"));
        getWindow().setNavigationBarColor(Color.parseColor("#0b1f1a"));
        prefs = getSharedPreferences("wa", MODE_PRIVATE);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#0b1f1a"));
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0b1f1a"));
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        bar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(100);
        root.addView(bar, new FrameLayout.LayoutParams(-1, 8));
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setMediaPlaybackRequiresUserGesture(false);

        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView v, int p) {
                bar.setProgress(p);
                bar.setVisibility(p >= 100 ? View.GONE : View.VISIBLE);
            }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                String u = r.getUrl().toString();
                if (u.startsWith("https://retry.local")) { v.loadUrl(baseUrl); return true; }
                if (baseUrl != null && u.startsWith(baseUrl)) return false;
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(u)));
                return true;
            }
            @Override public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if (r.isForMainFrame()) {
                    v.loadData("<body style='background:#0b1f1a;color:#eee;font-family:sans-serif;text-align:center;padding-top:30vh'>"
                        + "<h2>Connect nahi ho paya</h2><p style='color:#8fa8a0'>Internet ya server URL check karo</p>"
                        + "<p><a style='color:#d4b36a' href='https://retry.local'>Retry</a></p></body>", "text/html", "UTF-8");
                }
            }
        });

        baseUrl = prefs.getString("url", null);
        if (baseUrl == null) askUrl(true); else web.loadUrl(baseUrl);
    }

    private void askUrl(boolean first) {
        if (dialogOpen) return;
        dialogOpen = true;
        final EditText et = new EditText(this);
        et.setInputType(InputType.TYPE_TEXT_VARIATION_URI);
        et.setHint("https://your-server.com");
        et.setText(baseUrl == null ? "https://" : baseUrl);
        FrameLayout box = new FrameLayout(this);
        box.setPadding(60, 20, 60, 0);
        box.addView(et, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        AlertDialog.Builder d = new AlertDialog.Builder(this)
            .setTitle("Server URL")
            .setMessage("Apne deploy kiye server ka address daalo")
            .setView(box)
            .setCancelable(!first)
            .setPositiveButton("Save", (di, w) -> {
                String u = et.getText().toString().trim();
                if (u.endsWith("/")) u = u.substring(0, u.length() - 1);
                if (!u.startsWith("http")) u = "https://" + u;
                baseUrl = u;
                prefs.edit().putString("url", u).apply();
                web.loadUrl(u);
            })
            .setOnDismissListener(di -> dialogOpen = false);
        if (!first) d.setNegativeButton("Cancel", null);
        d.show();
    }

    // Long-press back button area: menu key opens URL settings
    @Override public boolean onKeyLongPress(int k, android.view.KeyEvent e) {
        if (k == android.view.KeyEvent.KEYCODE_BACK) { askUrl(false); return true; }
        return super.onKeyLongPress(k, e);
    }
    @Override public boolean onKeyDown(int k, android.view.KeyEvent e) {
        if (k == android.view.KeyEvent.KEYCODE_BACK) { e.startTracking(); return true; }
        return super.onKeyDown(k, e);
    }
    @Override public boolean onKeyUp(int k, android.view.KeyEvent e) {
        if (k == android.view.KeyEvent.KEYCODE_BACK && !e.isCanceled()) {
            if (web.canGoBack()) web.goBack(); else finish();
            return true;
        }
        return super.onKeyUp(k, e);
    }
}
