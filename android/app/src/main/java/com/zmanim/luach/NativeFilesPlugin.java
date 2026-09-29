package com.zmanim.luach;

import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintJob;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.util.Base64;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

// ב-WebView של אנדרואיד window.print() לא עושה כלום, והורדה של כתובת blob: דרך <a download> לא קורית.
// התוסף מדפיס את הדף דרך PrintManager ושומר קבצים בתיקיית ההורדות (או פותח/משתף אותם). הקריאות מ-js/native-files.js.
@CapacitorPlugin(name = "NativeFiles")
public class NativeFilesPlugin extends Plugin {

    @PluginMethod
    public void print(PluginCall call) {
        String title = call.getString("title", "לוח זמנים");
        String paper = call.getString("paper", "A4");
        boolean landscape = Boolean.TRUE.equals(call.getBoolean("landscape", false));
        getActivity().runOnUiThread(() -> {
            PrintManager pm = (PrintManager) getContext().getSystemService(Context.PRINT_SERVICE);
            PrintAttributes.MediaSize size = "A3".equals(paper) ? PrintAttributes.MediaSize.ISO_A3 : PrintAttributes.MediaSize.ISO_A4;
            PrintAttributes attrs = new PrintAttributes.Builder()
                .setMediaSize(landscape ? size.asLandscape() : size.asPortrait())
                .build();
            // ה-JS מחזיר את הלוח לתצוגה הרגילה רק כשההדפסה נגמרה (onFinish), כי הדף נמדד שוב בכל שינוי בחלון ההדפסה
            PrintDocumentAdapter inner = getBridge().getWebView().createPrintDocumentAdapter(title);
            PrintDocumentAdapter adapter = new PrintDocumentAdapter() {
                @Override public void onStart() { inner.onStart(); }
                @Override public void onLayout(PrintAttributes o, PrintAttributes n, CancellationSignal c, LayoutResultCallback cb, Bundle b) { inner.onLayout(o, n, c, cb, b); }
                @Override public void onWrite(PageRange[] p, ParcelFileDescriptor d, CancellationSignal c, WriteResultCallback cb) { inner.onWrite(p, d, c, cb); }
                @Override public void onFinish() { inner.onFinish(); call.resolve(); }
            };
            PrintJob job = pm.print(title, adapter, attrs);
            if (job == null) call.reject("print failed");
        });
    }

    // mode: "save" – לתיקיית ההורדות (באנדרואיד 9 ומטה, שבו זה דורש הרשאה, נפתח חלון שיתוף במקום);
    // "open" – פתיחה באפליקציה שמטפלת בסוג הקובץ (למשל .ics ביומן), ואם אין כזו – חלון שיתוף.
    @PluginMethod
    public void save(PluginCall call) {
        String name = call.getString("name", "file").replaceAll("[\\\\/:*?\"<>|]", "");
        String mime = call.getString("mime", "application/octet-stream");
        String mode = call.getString("mode", "save");
        String data = call.getString("data", "");
        try {
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            JSObject ret = new JSObject();
            if ("save".equals(mode) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentResolver cr = getContext().getContentResolver();
                ContentValues v = new ContentValues();
                v.put(MediaStore.Downloads.DISPLAY_NAME, name);
                v.put(MediaStore.Downloads.MIME_TYPE, mime);
                Uri uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (uri == null) throw new Exception("insert failed");
                try (OutputStream out = cr.openOutputStream(uri)) { out.write(bytes); }
                ret.put("result", "saved");
                call.resolve(ret);
                return;
            }
            File dir = new File(getContext().getCacheDir(), "shared");
            dir.mkdirs();
            File file = new File(dir, name);
            try (FileOutputStream out = new FileOutputStream(file)) { out.write(bytes); }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            if ("open".equals(mode)) {
                Intent view = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                try {
                    getActivity().startActivity(view);
                    ret.put("result", "opened");
                    call.resolve(ret);
                    return;
                } catch (ActivityNotFoundException ignored) {}
            }
            Intent send = new Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(Intent.createChooser(send, name));
            ret.put("result", "shared");
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("save failed", e);
        }
    }
}
