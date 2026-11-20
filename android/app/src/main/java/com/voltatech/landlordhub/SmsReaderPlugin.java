package com.voltatech.landlordhub;

import android.Manifest;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The app's window onto MoMo and Airtel "money received" SMS (used from native.js).
 * The landlord is asked once for permission. Only money-received messages are ever passed on.
 */
@CapacitorPlugin(
    name = "SmsReader",
    permissions = {
        @Permission(alias = "sms", strings = { Manifest.permission.RECEIVE_SMS, Manifest.permission.READ_SMS }),
        @Permission(alias = "notifications", strings = { "android.permission.POST_NOTIFICATIONS" })
    }
)
public class SmsReaderPlugin extends Plugin {
    private static SmsReaderPlugin live;

    @Override
    public void load() { live = this; }

    @Override
    protected void handleOnDestroy() { if (live == this) live = null; }

    /** Called by SmsReceiver. Returns true if the open app took the message. */
    static boolean deliverLive(String from, String body, long date) {
        SmsReaderPlugin p = live;
        if (p == null || p.getBridge() == null || p.getActivity() == null || !p.hasListeners("smsReceived")) return false;
        JSObject m = new JSObject();
        m.put("from", from);
        m.put("body", body);
        m.put("date", date);
        p.notifyListeners("smsReceived", m);
        // It stays in the store too; the app clears it after recording, so nothing is lost.
        return true;
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        r.put("granted", getPermissionState("sms") == PermissionState.GRANTED);
        call.resolve(r);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (getPermissionState("sms") == PermissionState.GRANTED && notificationsReady()) { status(call); return; }
        if (Build.VERSION.SDK_INT >= 33) requestPermissionForAliases(new String[] { "sms", "notifications" }, call, "afterPermission");
        else requestPermissionForAlias("sms", call, "afterPermission");
    }

    private boolean notificationsReady() {
        return Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED;
    }

    @PermissionCallback
    private void afterPermission(PluginCall call) { status(call); }

    /** Messages kept while the app was closed. They are cleared once handed over. */
    @PluginMethod
    public void getPending(PluginCall call) {
        JSONArray list = SmsStore.takeAll(getContext());
        JSObject r = new JSObject();
        r.put("messages", JSArray.from(toList(list)));
        call.resolve(r);
    }

    /** Money-received messages already in the inbox since a time (e.g. since the last check). */
    @PluginMethod
    public void readInbox(PluginCall call) {
        if (getPermissionState("sms") != PermissionState.GRANTED) { call.reject("SMS permission not given"); return; }
        long since = call.getLong("since", 0L);
        JSArray out = new JSArray();
        String[] cols = { "address", "body", "date" };
        try (Cursor c = getContext().getContentResolver().query(Uri.parse("content://sms/inbox"), cols,
                "date > ?", new String[] { String.valueOf(since) }, "date ASC")) {
            if (c != null) {
                while (c.moveToNext() && out.length() < 500) {
                    String body = c.getString(1);
                    if (!SmsStore.isTrustedSender(c.getString(0)) || !SmsStore.looksLikeMoneyIn(body)) continue; // everything else stays private
                    JSObject m = new JSObject();
                    m.put("from", c.getString(0));
                    m.put("body", body);
                    m.put("date", c.getLong(2));
                    out.put(m);
                }
            }
        } catch (Exception e) {
            call.reject("Could not read messages", e);
            return;
        }
        JSObject r = new JSObject();
        r.put("messages", out);
        call.resolve(r);
    }

    private static java.util.List<Object> toList(JSONArray a) {
        java.util.List<Object> l = new java.util.ArrayList<>();
        for (int i = 0; i < a.length(); i++) {
            JSONObject o = a.optJSONObject(i);
            if (o != null) l.add(o);
        }
        return l;
    }
}
