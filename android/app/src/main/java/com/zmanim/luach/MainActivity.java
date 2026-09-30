package com.zmanim.luach;

import android.content.Intent;
import android.graphics.Rect;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.DisplayCutout;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.ServiceWorkerClient;
import android.webkit.ServiceWorkerController;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeWebViewClient;
import java.util.Map;

public class MainActivity extends BridgeActivity {

    private static final String RETURN_SCHEME = "com.zmanim.luach";

    // השרת המקומי של Capacitor מחזיר את index.html הראשי (לוח הזמנים) לכל כתובת בלי נקודה, כך ש-/gabbai/,
    // /kiddush/ וכו' הציגו את לוח הזמנים. מפנים כתובת שמסתיימת ב-/ ל-index.html שבתיקייה, גם לבקשות של ה-service worker.
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeFilesPlugin.class);
        registerPlugin(AppUpdaterPlugin.class);
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            getWindow().getAttributes().layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }
        hideStatusBar();
        if (bridge == null) return;
        // בלי תוסף @capacitor/app כפתור "חזרה" סוגר את האפליקציה. קודם הדף סוגר חלון/מגירה פתוחים (SiteBack ב-js/menu.js),
        // אחר כך חוזרים לדף הקודם, ורק בדף הראשון האפליקציה עוברת לרקע.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView web = bridge.getWebView();
                web.evaluateJavascript("!!(window.SiteBack && SiteBack.handle())", handled -> {
                    if ("true".equals(handled)) return;
                    if (web.canGoBack()) web.goBack();
                    else moveTaskToBack(true);
                });
            }
        });
        bridge.setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return super.shouldInterceptRequest(view, withDirectoryIndex(request));
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                sendCutout();
            }
        });
        // בסיבוב המסך המצלמה עוברת צד
        bridge.getWebView().addOnLayoutChangeListener((v, l, t, r, b, ol, ot, or, ob) -> {
            if (r - l != or - ol || b - t != ob - ot) sendCutout();
        });
        ServiceWorkerController.getInstance().setServiceWorkerClient(new ServiceWorkerClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                return bridge.getLocalServer().shouldInterceptRequest(withDirectoryIndex(request));
            }
        });
    }

    // האפליקציה מתפרסת גם על שורת הסטטוס (השעה והסוללה); החלקה מלמעלה מציגה אותה לרגע.
    // תוסף SystemBars של Capacitor מציג את הפסים בזמן הטעינה, לכן מסתירים שוב כשהחלון מקבל פוקוס.
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideStatusBar();
    }

    private void hideStatusBar() {
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controller.hide(WindowInsetsCompat.Type.statusBars());
    }

    // הדף יודע רק את גובה אזור המצלמה (safe-area-inset-top), לא איפה היא לרוחב. שולחים ל-js/menu.js את
    // המלבנים של המצלמה ביחס ל-WebView, כדי שהפס העליון יסדר את כפתור התפריט והכותרת לצידה.
    private void sendCutout() {
        if (bridge == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return;
        WebView web = bridge.getWebView();
        WindowInsets insets = web.getRootWindowInsets();
        if (insets == null || web.getWidth() == 0) return;
        DisplayCutout cutout = insets.getDisplayCutout();
        int[] at = new int[2];
        web.getLocationInWindow(at);
        StringBuilder rects = new StringBuilder();
        if (cutout != null) {
            for (Rect r : cutout.getBoundingRects()) {
                if (rects.length() > 0) rects.append(',');
                rects.append('[').append(r.left - at[0]).append(',').append(r.top - at[1])
                     .append(',').append(r.right - at[0]).append(',').append(r.bottom - at[1]).append(']');
            }
        }
        web.evaluateJavascript("window.SiteMenu && SiteMenu.setCutout && SiteMenu.setCutout({w:" + web.getWidth()
                + ",rects:[" + rects + "]})", null);
    }

    private WebResourceRequest withDirectoryIndex(WebResourceRequest request) {
        Uri url = request.getUrl();
        String path = url.getEncodedPath();
        if (path == null || path.length() < 2 || !path.endsWith("/")) return request;
        if (!Uri.parse(bridge.getLocalUrl()).getHost().equals(url.getHost())) return request;
        Uri indexUrl = url.buildUpon().encodedPath(path + "index.html").build();
        return new WebResourceRequest() {
            @Override public Uri getUrl() { return indexUrl; }
            @Override public boolean isForMainFrame() { return request.isForMainFrame(); }
            @Override public boolean isRedirect() { return request.isRedirect(); }
            @Override public boolean hasGesture() { return request.hasGesture(); }
            @Override public String getMethod() { return request.getMethod(); }
            @Override public Map<String, String> getRequestHeaders() { return request.getRequestHeaders(); }
        };
    }

    // אחרי ההתחברות עם Google בדפדפן החיצוני, Convex Auth מפנה ל-com.zmanim.luach://localhost/<דף>?code=...
    // טוענים את אותו דף ב-WebView, ושם js/auth.js משלים את הכניסה עם ה-code.
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        Uri uri = intent == null ? null : intent.getData();
        if (bridge == null || uri == null || !RETURN_SCHEME.equals(uri.getScheme())) return;
        String path = uri.getEncodedPath() == null ? "/" : uri.getEncodedPath();
        String query = uri.getEncodedQuery() == null ? "" : "?" + uri.getEncodedQuery();
        bridge.getWebView().loadUrl(bridge.getLocalUrl() + path + query);
    }
}
