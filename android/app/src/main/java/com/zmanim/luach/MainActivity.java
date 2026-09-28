package com.zmanim.luach;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.ServiceWorkerClient;
import android.webkit.ServiceWorkerController;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import java.util.Map;

public class MainActivity extends BridgeActivity {

    private static final String RETURN_SCHEME = "com.zmanim.luach";

    // השרת המקומי של Capacitor מחזיר את index.html הראשי (לוח הזמנים) לכל כתובת בלי נקודה, כך ש-/gabbai/,
    // /kiddush/ וכו' הציגו את לוח הזמנים. מפנים כתובת שמסתיימת ב-/ ל-index.html שבתיקייה, גם לבקשות של ה-service worker.
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (bridge == null) return;
        bridge.setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return super.shouldInterceptRequest(view, withDirectoryIndex(request));
            }
        });
        ServiceWorkerController.getInstance().setServiceWorkerClient(new ServiceWorkerClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                return bridge.getLocalServer().shouldInterceptRequest(withDirectoryIndex(request));
            }
        });
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
