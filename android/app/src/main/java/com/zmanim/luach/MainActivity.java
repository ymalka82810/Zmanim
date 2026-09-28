package com.zmanim.luach;

import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static final String RETURN_SCHEME = "com.zmanim.luach";

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
